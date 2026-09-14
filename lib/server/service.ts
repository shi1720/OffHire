import { CalleAPIError } from "@call-e/calle";
import {
  activeStatuses,
  terminalStatuses,
  type CallSnapshot,
  type Job,
  type Rental,
  type Scenario,
} from "../offhire/types";
import { compileCallPlan, callWindow } from "../offhire/call-plan";
import { reconcileCall } from "../offhire/decision";
import { fixtureCall, demoRentals } from "../offhire/fixtures";
import { createCall, readCall } from "./provider";
import {
  compareAndSaveJob,
  releaseTerminalLock,
  claimDispatch,
  ensureWorkspace,
  getJob,
  getRental,
  jobsFor,
  recordAudit,
  saveJob,
  setting,
  numberSetting,
} from "./store";

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const publicJob = (j: Job) => {
  const { requestJson: _request, idempotencyKey: _key, ...rest } = j;
  return rest;
};
export function seedJobs(rentals: Rental[]): Job[] {
  return rentals.slice(1).map((r, i) => {
    const call = fixtureCall(
      r,
      i === 0 ? "ambiguous" : "confirmed",
      `sim-seed-${r.id}`,
    );
    const date = new Date(Date.parse(r.createdAt) + i + 5000).toISOString();
    return {
      id: `seed-${r.id}`,
      workspaceId: r.workspaceId,
      rentalId: r.id,
      mode: "demo",
      status: "completed",
      idempotencyKey: `seed-${r.id}`,
      requestJson: "{}",
      scenario: i === 0 ? "ambiguous" : "confirmed",
      callId: call.id,
      createdAt: date,
      updatedAt: date,
      grantExpiresAt: date,
      approvedBy: "Sample scenario",
      decision: reconcileCall(call, r),
      snapshot: call,
      error: null,
      nextCheckAt: null,
    };
  });
}
export async function initializeWorkspace(
  id: string,
  mode: "demo" | "live",
): Promise<void> {
  const rentals = mode === "demo" ? demoRentals(id) : [];
  await ensureWorkspace(id, mode, rentals, seedJobs(rentals));
}
export async function prepareJob(
  r: Rental,
  mode: "demo" | "live",
  scenario: Scenario,
): Promise<Job> {
  if (!r.ready)
    throw new ServiceError(
      "The site lead must confirm this asset is ready before a verification call.",
    );
  const jobs = await jobsFor(r.workspaceId);
  if (jobs.length >= 200)
    throw new ServiceError(
      "This workspace has reached its 200-plan limit. Export and review existing records.",
      409,
    );
  if (
    jobs.some((j) => j.rentalId === r.id && activeStatuses.includes(j.status))
  )
    throw new ServiceError(
      "This asset already has an active or unresolved call. Reconcile that call first.",
      409,
    );
  if (jobs.filter((j) => j.rentalId === r.id).length >= 20)
    throw new ServiceError(
      "This asset has reached its attempt limit. Review the existing evidence.",
      409,
    );
  const latest = jobs.find((j) => j.rentalId === r.id && j.decision);
  if (latest?.decision?.billing === "reported_off_rent")
    throw new ServiceError(
      "This rental already has a confirmed cutoff. Review the receipt instead of calling again.",
      409,
    );
  const id = crypto.randomUUID();
  const now = new Date();
  const job: Job = {
    id,
    workspaceId: r.workspaceId,
    rentalId: r.id,
    mode,
    status: "prepared",
    idempotencyKey: `offhire:${id}:v1`,
    requestJson: JSON.stringify(
      compileCallPlan(
        r,
        id,
        mode === "live"
          ? setting("OFFHIRE_WEBHOOK_URL") || undefined
          : undefined,
      ),
    ),
    scenario,
    callId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    grantExpiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
    approvedBy: null,
    decision: null,
    snapshot: null,
    error: null,
    nextCheckAt: null,
  };
  await saveJob(job);
  return job;
}
export function assertLiveAllowed(r: Rental, job: Job, now: Date = new Date()) {
  if (setting("OFFHIRE_ENABLE_LIVE") !== "true")
    throw new ServiceError("Live calls are disabled in this deployment.", 403);
  if (!setting("CALLE_API_KEY"))
    throw new ServiceError("The CALL-E key has not been configured.", 503);
  if (!r.ready || !r.authorizedContact)
    throw new ServiceError(
      "Confirm asset readiness and permission to contact this destination.",
      403,
    );
  const allowed = setting("OFFHIRE_ALLOWED_PHONES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!r.phone || !allowed.includes(r.phone))
    throw new ServiceError(
      "This destination is not in the server's approved phone list.",
      403,
    );
  if (new Date(job.grantExpiresAt) <= now)
    throw new ServiceError(
      "The reviewed plan has expired. Do not replay an uncertain request; reconcile it with CALL-E support first.",
      409,
    );
  if (!r.isTest && !callWindow(r.timezone, now).allowed)
    throw new ServiceError(
      `Outside the supplier's calling hours. ${callWindow(r.timezone, now).label}.`,
      409,
    );
}

async function applySnapshot(job: Job, call: CallSnapshot): Promise<Job> {
  if (job.callId && job.callId !== call.id)
    throw new ServiceError("CALL-E returned an unexpected call ID.", 502);
  if (!["queued", "in_progress", ...terminalStatuses].includes(call.status))
    throw new ServiceError(
      "CALL-E returned an unknown lifecycle state. The call remains open for review.",
      502,
    );
  const r = await getRental(job.rentalId, job.workspaceId);
  if (!r) throw new ServiceError("Rental record is missing.", 404);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getJob(job.id, job.workspaceId);
    if (!current) throw new ServiceError("Call record is missing.", 404);
    if (terminalStatuses.includes(current.status)) {
      await releaseTerminalLock(current.id);
      return current;
    }
    if (current.callId && current.callId !== call.id)
      throw new ServiceError("CALL-E returned an unexpected call ID.", 502);
    if (current.status === "in_progress" && call.status === "queued")
      return current;
    const isTerminal = terminalStatuses.includes(call.status);
    const next = {
      ...current,
      callId: call.id,
      status: call.status as Job["status"],
      snapshot: call,
      decision: isTerminal ? reconcileCall(call, r) : null,
      error: null,
      updatedAt: new Date().toISOString(),
      nextCheckAt: isTerminal
        ? null
        : new Date(Date.now() + 5000).toISOString(),
    };
    if (await compareAndSaveJob(current, next)) {
      if (isTerminal)
        await recordAudit(
          job.workspaceId,
          job.rentalId,
          "call_reconciled",
          `${job.mode}: ${next.decision?.title}`,
        );
      return next;
    }
  }
  throw new ServiceError(
    "Call state changed concurrently. Refresh the saved call.",
    409,
  );
}
export async function dispatchJob(job: Job, actor: string): Promise<Job> {
  if (job.callId) return refreshJob(job);
  if (!["prepared", "dispatch_uncertain"].includes(job.status))
    throw new ServiceError(
      "This call has already been submitted. Refresh its status.",
      409,
    );
  const r = await getRental(job.rentalId, job.workspaceId);
  if (!r) throw new ServiceError("Rental not found.", 404);
  if (job.mode === "demo") {
    const next = {
      ...job,
      status: "dispatching" as const,
      approvedBy: actor,
      updatedAt: new Date().toISOString(),
    };
    await saveJob(next);
    return applySnapshot(next, fixtureCall(r, job.scenario, `sim-${job.id}`));
  }
  assertLiveAllowed(r, job);
  const latest = (await jobsFor(r.workspaceId)).find(
    (j) => j.rentalId === r.id && j.decision,
  );
  if (latest?.decision?.billing === "reported_off_rent")
    throw new ServiceError(
      "A newer call already confirmed this cutoff. Review the receipt instead of calling again.",
      409,
    );
  const next = {
    ...job,
    status: "dispatching" as const,
    approvedBy: actor,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  // The repository owns the account-wide lock, immutable budget reservation,
  // and saved-payload claim. Provider requests only follow a winning claim.
  const claimed = await claimDispatch(
    job,
    next,
    numberSetting("OFFHIRE_CALL_LIMIT", 5),
  );
  if (claimed === "busy")
    throw new ServiceError(
      "Another live call is still active or awaiting reconciliation. Finish it before calling again.",
      409,
    );
  if (claimed === "budget_exhausted")
    throw new ServiceError(
      "The configured live-call budget is used. Review usage before increasing the server limit.",
      409,
    );
  if (claimed !== "claimed") {
    const fresh = await getJob(job.id, job.workspaceId);
    if (fresh) await recoverDispatching(fresh);
    await releaseTerminalLock(job.id);
    throw new ServiceError(
      "This submission is already being processed or the plan expired. Refresh status.",
      409,
    );
  }
  try {
    return await applySnapshot(
      next,
      await createCall(next.requestJson, next.idempotencyKey),
    );
  } catch (error) {
    // 408/409/429/5xx and transport failures remain uncertain. Never invent a new key.
    const status = error instanceof CalleAPIError ? error.status : 0;
    const definitive = [400, 401, 403, 404, 422].includes(status);
    const safeMessage = definitive
      ? `CALL-E rejected the request (HTTP ${status}). Check connection, credit, region and plan details.`
      : "The submission response was interrupted. The call may already exist. Recover this exact request; do not start another call.";
    const fresh = await getJob(next.id, next.workspaceId);
    if (fresh && (terminalStatuses.includes(fresh.status) || fresh.callId))
      return fresh;
    const failed = {
      ...(fresh || next),
      status: (definitive ? "failed" : "dispatch_uncertain") as Job["status"],
      error: safeMessage,
      updatedAt: new Date().toISOString(),
    };
    if (fresh && (await compareAndSaveJob(fresh, failed))) return failed;
    return (await getJob(next.id, next.workspaceId)) || failed;
  }
}
export async function refreshJob(job: Job, force = false): Promise<Job> {
  if (terminalStatuses.includes(job.status)) {
    await releaseTerminalLock(job.id);
    return job;
  }
  if (job.mode === "demo" || !job.callId) return job;
  if (!force && job.nextCheckAt && Date.parse(job.nextCheckAt) > Date.now())
    return job;
  try {
    return await applySnapshot(job, await readCall(job.callId));
  } catch {
    const current = await getJob(job.id, job.workspaceId);
    if (!current) return job;
    if (terminalStatuses.includes(current.status)) {
      await releaseTerminalLock(current.id);
      return current;
    }
    const next = {
      ...current,
      error:
        "Status could not be retrieved. The saved CALL-E call ID is retained; no new call was placed.",
      updatedAt: new Date().toISOString(),
      nextCheckAt: new Date(Date.now() + 15000).toISOString(),
    };
    if (await compareAndSaveJob(current, next)) return next;
    return (await getJob(job.id, job.workspaceId)) || current;
  }
}
export async function recoverDispatching(job: Job): Promise<Job> {
  if (terminalStatuses.includes(job.status)) return job;
  let next: Job | undefined;
  if (job.status === "prepared" && Date.parse(job.grantExpiresAt) < Date.now())
    next = {
      ...job,
      status: "expired",
      updatedAt: new Date().toISOString(),
      error: "This unsubmitted call plan expired. Preview a new plan.",
    };
  if (
    job.status === "dispatching" &&
    Date.now() - Date.parse(job.updatedAt) > 60000
  )
    next = {
      ...job,
      status: "dispatch_uncertain",
      updatedAt: new Date().toISOString(),
      error:
        "Submission was interrupted. Recover using the original request and idempotency key.",
    };
  if (next) {
    if (await compareAndSaveJob(job, next)) return next;
    return (await getJob(job.id, job.workspaceId)) || job;
  }
  return job;
}
