import { z } from "zod";
import { rentalInput, type Rental, type Scenario } from "@/lib/offhire/types";
import { demoRentals } from "@/lib/offhire/fixtures";
import { invoiceReview } from "@/lib/offhire/decision";
import {
  database,
  getJob,
  getRental,
  jobsFor,
  rentalsFor,
  saveRental,
  setting,
  numberSetting,
  recordAudit,
  rentalStatement,
  jobStatement,
} from "@/lib/server/store";
import {
  dispatchJob,
  initializeWorkspace,
  prepareJob,
  publicJob,
  recoverDispatching,
  refreshJob,
  seedJobs,
  ServiceError,
} from "@/lib/server/service";
import { verifyConnection } from "@/lib/server/provider";
export const dynamic = "force-dynamic";
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const modeSchema = z.enum(["demo", "live"]);

async function context(request: Request) {
  const url = new URL(request.url);
  const mode = modeSchema.parse(url.searchParams.get("mode") || "demo");
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email") || null;
  const owner =
    !!userId &&
    !!email &&
    setting("OFFHIRE_OWNER_EMAILS")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase());
  if (mode === "live" && !owner)
    throw new ServiceError(
      userId
        ? "This account is not an authorized live-workspace operator."
        : "Sign in to access the live workspace.",
      403,
    );
  const cookie = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)offhire_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const session =
    cookie ||
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const workspaceId = mode === "live" ? "live-workspace" : `demo-${session}`;
  await initializeWorkspace(workspaceId, mode);
  return {
    mode,
    workspaceId,
    owner,
    email,
    signedIn: !!userId,
    actor: mode === "demo" ? "Demo operator" : email!,
    cookie: cookie
      ? null
      : `offhire_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${url.protocol === "https:" ? "; Secure" : ""}`,
  };
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ServiceError("Send JSON for this action.", 415);
  if (Number(request.headers.get("content-length") || 0) > 300000)
    throw new ServiceError("The request is too large.", 413);
  const data = await request.text();
  if (data.length > 300000)
    throw new ServiceError("The request is too large.", 413);
  try {
    return JSON.parse(data);
  } catch {
    throw new ServiceError("The request is not valid JSON.");
  }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ServiceError("Cross-origin changes are not allowed.", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site")
    throw new ServiceError("Cross-site changes are not allowed.", 403);
}
async function webhook(request: Request, token: string) {
  if (
    !setting("OFFHIRE_WEBHOOK_TOKEN") ||
    token !== setting("OFFHIRE_WEBHOOK_TOKEN")
  )
    throw new ServiceError("Not found.", 404);
  const event = z
    .object({
      id: z.string().min(1).max(200),
      type: z.enum([
        "call.completed",
        "call.failed",
        "call.result_validation_failed",
      ]),
      data: z.object({ id: z.string().min(1).max(100) }),
    })
    .passthrough()
    .parse(await body(request));
  if (request.headers.get("CALL-E-Event-Id") !== event.id)
    throw new ServiceError("Event ID mismatch.");
  if (
    await database()
      .prepare("SELECT id FROM events WHERE id=?")
      .bind(event.id)
      .first()
  )
    return json({ received: true, duplicate: true });
  const row = await database()
    .prepare("SELECT payload FROM jobs WHERE call_id=? AND mode='live'")
    .bind(event.data.id)
    .first<{ payload: string }>();
  if (!row)
    throw new ServiceError(
      "The call record is not yet available. Retry delivery.",
      503,
    );
  const job = JSON.parse(row.payload);
  const reconciled = await refreshJob(job, true);
  // Unsigned body data never updates business fields. Authenticated GET must succeed.
  if (
    !["completed", "failed", "canceled"].includes(reconciled.status) ||
    reconciled.error
  )
    throw new ServiceError(
      "Call verification is pending. Retry delivery.",
      503,
    );
  await database()
    .prepare(
      "INSERT OR IGNORE INTO events (id,job_id,created_at) VALUES (?,?,?)",
    )
    .bind(event.id, job.id, new Date().toISOString())
    .run();
  return json({ received: true });
}
async function handler(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\//, "").split("/");
  try {
    if (request.method === "GET" && path[0] === "health")
      return json({ application: "offhire", version: "1.0.0", status: "ok" });
    if (
      request.method === "POST" &&
      path[0] === "webhooks" &&
      path[1] === "calle"
    )
      return await webhook(request, path[2] || "");
    if (request.method === "POST") sameOrigin(request);
    const ctx = await context(request);
    const response = (data: unknown, status = 200) =>
      json(data, status, ctx.cookie ? { "Set-Cookie": ctx.cookie } : {});
    if (request.method === "GET" && path[0] === "state") {
      const [rentals, jobs, used] = await Promise.all([
        rentalsFor(ctx.workspaceId),
        jobsFor(ctx.workspaceId),
        database()
          .prepare("SELECT COUNT(*) as used FROM usage_limits")
          .first<{ used: number }>(),
      ]);
      const recovered = await Promise.all(jobs.map(recoverDispatching));
      return response({
        mode: ctx.mode,
        rentals,
        jobs: recovered.map(publicJob),
        connection: {
          configured: !!setting("CALLE_API_KEY"),
          liveEnabled: setting("OFFHIRE_ENABLE_LIVE") === "true",
          owner: ctx.owner,
          signedIn: ctx.signedIn,
          email: ctx.owner ? ctx.email : null,
          remainingCalls: Math.max(
            0,
            numberSetting("OFFHIRE_CALL_LIMIT", 5) - (used?.used ?? 0),
          ),
          callLimit: numberSetting("OFFHIRE_CALL_LIMIT", 5),
        },
      });
    }
    if (request.method === "GET" && path[0] === "export") {
      const rentals = await rentalsFor(ctx.workspaceId);
      const jobs = await jobsFor(ctx.workspaceId);
      const logs = await database()
        .prepare(
          "SELECT action,detail,created_at,rental_id FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 500",
        )
        .bind(ctx.workspaceId)
        .all();
      return new Response(
        JSON.stringify(
          {
            application: "OffHire",
            owner: "Shivam Gupta",
            exportedAt: new Date().toISOString(),
            mode: ctx.mode,
            evidenceNotice:
              ctx.mode === "demo"
                ? "All business data and calls in this export are synthetic."
                : "Supplier-reported evidence, not invoice-verified savings or an official supplier document.",
            rentals,
            jobs: jobs.map(publicJob),
            audit: logs.results,
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="offhire-${ctx.mode}-evidence.json"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (request.method === "GET" && path[0] === "audit") {
      const rows = await database()
        .prepare(
          "SELECT action,detail,created_at,rental_id FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(ctx.workspaceId)
        .all();
      return response({ events: rows.results });
    }
    if (request.method !== "POST") throw new ServiceError("Not found.", 404);
    const data = await body(request);
    if (path[0] === "rentals" && path.length === 1) {
      const input = rentalInput.parse(data);
      if ((await rentalsFor(ctx.workspaceId)).length >= 100)
        throw new ServiceError(
          "This workspace has reached its 100-rental limit.",
          409,
        );
      if (ctx.mode === "demo") input.phone = "";
      const r: Rental = {
        ...input,
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        createdAt: new Date().toISOString(),
        collectedAt: null,
        writtenConfirmation: false,
        invoiceReviewed: false,
      };
      await saveRental(r);
      await recordAudit(
        ctx.workspaceId,
        r.id,
        "rental_created",
        `${r.assetId} · ${r.supplier}`,
      );
      return response({ rental: r }, 201);
    }
    if (path[0] === "rentals" && path[1]) {
      const r = await getRental(path[1], ctx.workspaceId);
      if (!r) throw new ServiceError("Rental not found.", 404);
      if (path[2] === "plan") {
        const parsed = z
          .object({
            scenario: z
              .enum([
                "confirmed",
                "ambiguous",
                "voicemail",
                "contradiction",
                "unsupported",
                "wrong_asset",
              ])
              .default("confirmed"),
          })
          .parse(data);
        const job = await prepareJob(r, ctx.mode, parsed.scenario as Scenario);
        const plan = JSON.parse(job.requestJson);
        return response(
          {
            job: publicJob(job),
            plan: {
              task: plan.task,
              recipients: plan.recipients,
              resultSchema: plan.resultSchema,
            },
          },
          201,
        );
      }
      if (path[2] === "record") {
        const input = z
          .object({
            action: z.enum([
              "collected",
              "written_confirmation",
              "invoice_reviewed",
            ]),
            note: z.string().trim().min(3).max(500),
          })
          .parse(data);
        if (input.action === "collected")
          r.collectedAt = new Date().toISOString();
        if (input.action === "written_confirmation")
          r.writtenConfirmation = true;
        if (input.action === "invoice_reviewed") r.invoiceReviewed = true;
        await saveRental(r);
        await recordAudit(
          ctx.workspaceId,
          r.id,
          input.action,
          `${ctx.actor}: ${input.note}`,
        );
        return response({ rental: r });
      }
      if (path[2] === "invoice") {
        const { billedThrough } = z
          .object({ billedThrough: z.string() })
          .parse(data);
        const jobs = await jobsFor(ctx.workspaceId);
        const decision =
          jobs.find((j) => j.rentalId === r.id && j.decision)?.decision ?? null;
        let review: ReturnType<typeof invoiceReview>;
        try {
          review = invoiceReview(billedThrough, decision);
        } catch {
          throw new ServiceError("Enter a valid invoice end date.", 400);
        }
        await recordAudit(
          ctx.workspaceId,
          r.id,
          "invoice_checked",
          `${billedThrough}: ${review.reason}`,
        );
        return response(review);
      }
    }
    if (path[0] === "jobs" && path[1]) {
      const job = await getJob(path[1], ctx.workspaceId);
      if (!job) throw new ServiceError("Call not found.", 404);
      if (path[2] === "dispatch") {
        if (data.approved !== true)
          throw new ServiceError(
            "Review and approve the exact call plan before dispatch.",
            403,
          );
        return response({ job: publicJob(await dispatchJob(job, ctx.actor)) });
      }
      if (path[2] === "refresh")
        return response({
          job: publicJob(await refreshJob(await recoverDispatching(job))),
        });
    }
    if (path[0] === "reset") {
      if (ctx.mode !== "demo")
        throw new ServiceError("Only a demo workspace can be reset.", 403);
      const rentals = demoRentals(ctx.workspaceId);
      await database().batch([
        database()
          .prepare("DELETE FROM jobs WHERE workspace_id=?")
          .bind(ctx.workspaceId),
        database()
          .prepare("DELETE FROM rentals WHERE workspace_id=?")
          .bind(ctx.workspaceId),
        database()
          .prepare("DELETE FROM audit WHERE workspace_id=?")
          .bind(ctx.workspaceId),
        ...rentals.map(rentalStatement),
        ...seedJobs(rentals).map(jobStatement),
      ]);
      return response({ reset: true });
    }
    if (path[0] === "connection" && path[1] === "verify") {
      if (ctx.mode !== "live" || !ctx.owner)
        throw new ServiceError(
          "Connection checks are restricted to live-workspace operators.",
          403,
        );
      await verifyConnection();
      return response({ connected: true });
    }
    throw new ServiceError("Not found.", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (error instanceof ServiceError)
      return json({ error: error.message }, error.status);
    console.error(
      "OffHire request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error:
          "This action could not be completed. Your saved records are retained. Please retry or check the server connection.",
      },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
