/** Real OffHire service/store/SDK regression harness. Node >=22.13. No network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "../..");
const scratch = path.join(site, "work", "test-service");
fs.mkdirSync(scratch, { recursive: true });
const require = createRequire(path.join(site, "package.json"));
const esbuild = require("esbuild");
const output = path.join(scratch, "regression.bundle.mjs");
await esbuild.build({
  entryPoints: [path.join(here, "entry.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "silent",
  plugins: [
    {
      name: "test-env-only",
      setup(b) {
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "env",
          namespace: "test-env",
        }));
        b.onLoad({ filter: /.*/, namespace: "test-env" }, () => ({
          contents: "export const env=globalThis.__OFFHIRE_TEST_ENV__;",
          loader: "js",
        }));
        b.onResolve({ filter: /^@\// }, (args) => ({
          path: path.join(site, args.path.slice(2)) + ".ts",
        }));
      },
    },
  ],
});
const env = {};
globalThis.__OFFHIRE_TEST_ENV__ = env;
const api = await import(output + "?v=" + Date.now());
const { service, store, fixtures, decision, evidence } = api;
const report = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const clone = (value) => structuredClone(value);
let db, provider;
class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    const migrations = fs
      .readdirSync(path.join(site, "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of migrations)
      this.sqlite.exec(fs.readFileSync(path.join(site, "drizzle", f), "utf8"));
    this.hook = null;
    this.batchHook = null;
  }
  prepare(sql) {
    return new Statement(this, sql, []);
  }
  async batch(statements) {
    if (this.batchHook) await this.batchHook(statements);
    this.sqlite.exec("BEGIN");
    try {
      const values = statements.map((s) => s.sync("run"));
      this.sqlite.exec("COMMIT");
      return values;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  row(sql, ...args) {
    return this.sqlite.prepare(sql).get(...args);
  }
  close() {
    this.sqlite.close();
  }
}
class Statement {
  constructor(db, sql, args) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }
  async invoke(method, column) {
    if (this.db.hook)
      await this.db.hook({ sql: this.sql, args: this.args, method });
    return this.sync(method, column);
  }
  sync(method, column) {
    const stmt = this.db.sqlite.prepare(this.sql);
    if (method === "first") {
      const row = stmt.get(...this.args);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    if (method === "all")
      return {
        results: stmt.all(...this.args),
        success: true,
        meta: { changes: 0 },
      };
    const result = stmt.run(...this.args);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
  run() {
    return this.invoke("run");
  }
  first(column) {
    return this.invoke("first", column);
  }
  all() {
    return this.invoke("all");
  }
}
function wire(r, callId, status = "queued", scenario = "confirmed") {
  const f = fixtures.fixtureCall(r, scenario, callId);
  return {
    id: callId,
    object: "call_task",
    status,
    task: "TEST ONLY",
    recipients: [
      {
        id: "rcp_test",
        phones: [r.phone],
        locale: "en",
        region: r.region,
        status: status === "completed" ? "completed" : "in_progress",
        structured_result: null,
        summary: null,
        attempts: [
          {
            id: "att_test",
            phone: r.phone,
            status: status === "completed" ? "completed" : "in_progress",
            started_at: new Date().toISOString(),
            completed_at:
              status === "completed" ? new Date().toISOString() : null,
            summary: null,
            transcript_turns: f.recipients[0].attempts[0].transcriptTurns,
            provider_call_id: "provider_test",
            failure_code: null,
            failure_message: null,
          },
        ],
      },
    ],
    structured_result: status === "completed" ? f.structuredResult : null,
    summary: null,
    task_completed: status === "completed" ? true : null,
    completion_confidence: null,
    evidence: [],
    metadata: {},
    failure_code: null,
    failure_message: null,
    created_at: new Date().toISOString(),
    completed_at: status === "completed" ? new Date().toISOString() : null,
  };
}
function makeProvider() {
  const p = {
    posts: [],
    gets: [],
    accepted: new Map(),
    calls: new Map(),
    throwAfterAccept: false,
    onGet: null,
    onPost: null,
    rental: null,
  };
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const u = new URL(request.url);
    assert.equal(
      u.origin,
      "https://api.heycall-e.com",
      "Unexpected network URL; never forwarding",
    );
    assert.equal(
      request.headers.get("authorization"),
      "Bearer TEST-ONLY-NOT-A-REAL-CREDENTIAL",
    );
    if (request.method === "POST" && u.pathname === "/v1/calls") {
      const body = await request.text(),
        key = request.headers.get("idempotency-key");
      p.posts.push({ body, key });
      assert.ok(key);
      let accepted = p.accepted.get(key);
      if (accepted && accepted.body !== body)
        return Response.json(
          {
            error: {
              code: "idempotency_conflict",
              message: "changed body",
              details: {},
            },
          },
          { status: 409 },
        );
      if (!accepted) {
        const id = "call_mock_" + (p.accepted.size + 1);
        accepted = { body, id };
        p.accepted.set(key, accepted);
        p.calls.set(id, wire(p.rental, id));
      }
      if (p.onPost) await p.onPost({ accepted, request });
      if (p.throwAfterAccept) {
        p.throwAfterAccept = false;
        throw new TypeError("Injected lost create response after acceptance");
      }
      return Response.json(p.calls.get(accepted.id), { status: 201 });
    }
    if (request.method === "GET" && /^\/v1\/calls\/[^/]+$/.test(u.pathname)) {
      const id = u.pathname.split("/").at(-1);
      p.gets.push(id);
      const result = p.onGet ? await p.onGet(id) : p.calls.get(id);
      return Response.json(result, { status: result ? 200 : 404 });
    }
    if (request.method === "GET" && u.pathname === "/v1/goals")
      return Response.json({ object: "list", data: [], next_cursor: null });
    throw new Error(
      "Unexpected request blocked: " + request.method + " " + u.pathname,
    );
  };
  return p;
}
async function setup() {
  if (db) db.close();
  db = new D1();
  Object.assign(env, {
    DB: db,
    CALLE_API_KEY: "TEST-ONLY-NOT-A-REAL-CREDENTIAL",
    OFFHIRE_ENABLE_LIVE: "true",
    OFFHIRE_ALLOWED_PHONES: "+15555550123",
    OFFHIRE_CALL_LIMIT: "5",
    OFFHIRE_WEBHOOK_TOKEN: "test-webhook-token",
    OFFHIRE_OWNER_EMAILS: "owner@example.invalid",
  });
  provider = makeProvider();
  await service.initializeWorkspace("live-workspace", "live");
  const r = {
    ...fixtures.demoRentals("live-workspace")[0],
    id: "r1",
    phone: "+15555550123",
    authorizedContact: true,
    isTest: true,
    createdAt: new Date().toISOString(),
  };
  await store.saveRental(r);
  provider.rental = r;
  return r;
}
const count = (table) => Number(db.row(`SELECT COUNT(*) AS n FROM ${table}`).n);
async function prepare(r) {
  return service.prepareJob(r, "live", "confirmed");
}
async function start(r) {
  const job = await prepare(r);
  return service.dispatchJob(job, "owner@example.invalid");
}
async function test(name, fn) {
  try {
    await setup();
    await fn();
    report.push({ name, status: "passed" });
    console.log("PASS " + name);
  } catch (error) {
    report.push({ name, status: "failed", error: error.stack });
    console.log("FAIL " + name + " — " + error.message);
  }
}
function denyConfirmation(change) {
  const r = provider.rental;
  const c = fixtures.fixtureCall(r, "confirmed");
  change(c, c.structuredResult);
  assert.notEqual(decision.reconcileCall(c, r).billing, "reported_off_rent");
}
await test("Prior evidence false positives fail closed", async () => {
  assert.equal(
    decision.reconcileCall(
      fixtures.fixtureCall(provider.rental, "confirmed"),
      provider.rental,
    ).billing,
    "reported_off_rent",
  );
  denyConfirmation((c, e) => (e.off_rent_at = "2099-12-31T23:00:00-05:00"));
  denyConfirmation((c, e) => {
    e.billing_quote = "I have received your billing inquiry.";
    c.recipients[0].attempts[0].transcriptTurns[3].text = e.billing_quote;
  });
  denyConfirmation((c, e) => {
    e.identity_quote = "I cannot verify asset SL-204 on contract CR-10842.";
    c.recipients[0].attempts[0].transcriptTurns[1].text = e.identity_quote;
  });
  denyConfirmation((c, e) => {
    e.identity_quote = "I can verify asset SL-2040 on contract CR-108420.";
    c.recipients[0].attempts[0].transcriptTurns[1].text = e.identity_quote;
  });
  denyConfirmation((c) =>
    c.recipients[0].attempts[0].transcriptTurns.push({
      speaker: "user",
      text: "Rental charges continue accruing on this contract.",
      offset_seconds: 90,
    }),
  );
  assert.throws(() => decision.invoiceReview("2026-02-30", null));
});
await test("Concurrent same-job dispatch sends one create and reserves once", async () => {
  const j = await prepare(provider.rental);
  const results = await Promise.allSettled([
    service.dispatchJob(clone(j), "owner"),
    service.dispatchJob(clone(j), "owner"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(provider.posts.length, 1);
  assert.equal(provider.accepted.size, 1);
  assert.equal(count("usage_limits"), 1);
  assert.equal((await store.getJob(j.id)).status, "queued");
});
await test("Different jobs obey account-wide capacity 1", async () => {
  const r2 = { ...provider.rental, id: "r2", assetId: "SL-205" };
  await store.saveRental(r2);
  const a = await prepare(provider.rental),
    b = await prepare(r2);
  await Promise.allSettled([
    service.dispatchJob(a, "owner"),
    service.dispatchJob(b, "owner"),
  ]);
  assert.equal(provider.posts.length, 1);
  assert.equal(provider.accepted.size, 1);
  assert.equal(count("dispatch_locks"), 1);
  assert.equal(count("usage_limits"), 1);
});
await test("Lost acceptance response replays identical request and key", async () => {
  const j = await prepare(provider.rental);
  provider.throwAfterAccept = true;
  const first = await service.dispatchJob(j, "owner");
  assert.equal(first.status, "dispatch_uncertain");
  assert.equal(first.callId, null);
  assert.equal(count("dispatch_locks"), 1);
  const again = await service.dispatchJob(await store.getJob(j.id), "owner");
  assert.equal(again.status, "queued");
  assert.equal(provider.posts.length, 2);
  assert.deepEqual(provider.posts[0], provider.posts[1]);
  assert.equal(provider.accepted.size, 1);
  assert.equal(count("usage_limits"), 1);
});
await test("Saved ID refresh never creates another call", async () => {
  const j = await start(provider.rental);
  provider.calls.set(j.callId, wire(provider.rental, j.callId, "completed"));
  const result = await service.refreshJob(j, true);
  assert.equal(result.status, "completed");
  assert.equal(result.decision.billing, "reported_off_rent");
  assert.equal(provider.posts.length, 1);
  assert.equal(count("dispatch_locks"), 0);
});
await test("Stale poll CAS cannot erase terminal callback receipt", async () => {
  const j = await start(provider.rental);
  const reached = deferred(),
    resume = deferred();
  let first = true;
  db.batchHook = async (statements) => {
    if (first && statements[0]?.args[0] === "in_progress") {
      first = false;
      reached.resolve();
      await resume.promise;
    }
  };
  let n = 0;
  provider.onGet = () =>
    wire(provider.rental, j.callId, ++n === 1 ? "in_progress" : "completed");
  const slow = service.refreshJob(clone(j), true);
  await reached.promise;
  const event = {
    id: "evt_race",
    type: "call.completed",
    data: { id: j.callId },
  };
  const callback = await api.POST(
    new Request("https://offhire.test/api/webhooks/calle/test-webhook-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CALL-E-Event-Id": event.id,
      },
      body: JSON.stringify(event),
    }),
  );
  assert.equal(callback.status, 200);
  resume.resolve();
  await slow;
  const saved = await store.getJob(j.id);
  assert.equal(saved.status, "completed");
  assert.equal(saved.decision.billing, "reported_off_rent");
  assert.equal(count("dispatch_locks"), 0);
  assert.equal(count("audit"), 1);
  assert.equal(count("events"), 1);
});
await test("Expired prepared orphan lock is released with CAS", async () => {
  const j = await prepare(provider.rental);
  j.grantExpiresAt = new Date(Date.now() - 1000).toISOString();
  await store.saveJob(j);
  await db
    .prepare("INSERT INTO dispatch_locks(id,job_id) VALUES('calle-account',?)")
    .bind(j.id)
    .run();
  const result = await service.recoverDispatching(j);
  assert.equal(result.status, "expired");
  assert.equal(count("dispatch_locks"), 0);
  assert.equal(provider.posts.length, 0);
  const next = await start(provider.rental);
  assert.equal(next.status, "queued");
});
await test("Expired uncertain submission is blocked while retaining capacity", async () => {
  const j = await prepare(provider.rental);
  provider.throwAfterAccept = true;
  const uncertain = await service.dispatchJob(j, "owner");
  uncertain.grantExpiresAt = new Date(Date.now() - 1000).toISOString();
  await store.saveJob(uncertain);
  await assert.rejects(
    () => service.dispatchJob(uncertain, "owner"),
    /expired/,
  );
  assert.equal(provider.posts.length, 1);
  assert.equal(count("dispatch_locks"), 1);
});
await test("Stale recovery cannot delete newly saved call ID", async () => {
  const j = await prepare(provider.rental);
  const stale = {
    ...j,
    status: "dispatching",
    updatedAt: new Date(Date.now() - 120000).toISOString(),
  };
  await store.saveJob(stale);
  const newer = {
    ...stale,
    status: "in_progress",
    callId: "call_existing",
    updatedAt: new Date().toISOString(),
  };
  await store.saveJob(newer);
  const result = await service.recoverDispatching(stale);
  assert.equal(result.status, "in_progress");
  assert.equal(result.callId, "call_existing");
});
await test("Unsigned webhook uses authenticated API data, not forged result", async () => {
  const j = await start(provider.rental);
  provider.calls.set(
    j.callId,
    wire(provider.rental, j.callId, "completed", "ambiguous"),
  );
  const fake = wire(provider.rental, j.callId, "completed", "confirmed");
  const event = { id: "evt_forged", type: "call.completed", data: fake };
  const req = () =>
    new Request("https://offhire.test/api/webhooks/calle/test-webhook-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CALL-E-Event-Id": event.id,
      },
      body: JSON.stringify(event),
    });
  assert.equal((await api.POST(req())).status, 200);
  assert.notEqual(
    (await store.getJob(j.id)).decision.billing,
    "reported_off_rent",
  );
  assert.equal(provider.gets.length, 1);
  assert.equal((await api.POST(req())).status, 200);
  assert.equal(provider.gets.length, 1);
  assert.equal(count("events"), 1);
});
await test("Webhook refetch failure is retryable and not deduped early", async () => {
  const j = await start(provider.rental);
  provider.onGet = () => {
    throw new TypeError("offline");
  };
  const event = {
    id: "evt_retry",
    type: "call.completed",
    data: { id: j.callId },
  };
  const req = () =>
    new Request("https://offhire.test/api/webhooks/calle/test-webhook-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CALL-E-Event-Id": event.id,
      },
      body: JSON.stringify(event),
    });
  assert.equal((await api.POST(req())).status, 503);
  assert.equal(count("events"), 0);
  provider.onGet = () => wire(provider.rental, j.callId, "completed");
  assert.equal((await api.POST(req())).status, 200);
  assert.equal(count("events"), 1);
  assert.equal((await store.getJob(j.id)).status, "completed");
});
await test("Expiry during reservation is rejected by database claim", async () => {
  const j = await prepare(provider.rental);
  const expiry = new Date(Date.now() + 50).toISOString();
  j.grantExpiresAt = expiry;
  await store.saveJob(j);
  db.hook = async ({ sql }) => {
    if (sql.startsWith("INSERT OR IGNORE INTO usage_limits"))
      await new Promise((r) => setTimeout(r, 100));
  };
  await assert.rejects(() => service.dispatchJob(j, "owner"), /expired/);
  assert.equal(provider.posts.length, 0);
  assert.equal((await store.getJob(j.id)).status, "expired");
  assert.equal(count("dispatch_locks"), 0);
});
await test("Full history survives more than 100 jobs", async () => {
  const r = provider.rental;
  const seed = await prepare(r);
  for (let i = 0; i < 105; i++) {
    await store.saveJob({
      ...seed,
      id: "historical_" + i,
      idempotencyKey: "historical_" + i,
      createdAt: new Date(Date.now() + i).toISOString(),
    });
  }
  assert.equal((await store.jobsFor(r.workspaceId)).length, 106);
});
await test("Latest evidence follows actual call order rather than preview creation", async () => {
  const r = provider.rental;
  const older = await prepare(r);
  older.createdAt = new Date(Date.now() - 1000).toISOString();
  await store.saveJob(older);
  const newer = await prepare(r);
  provider.onPost = ({ accepted }) =>
    provider.calls.set(
      accepted.id,
      wire(
        r,
        accepted.id,
        "completed",
        provider.posts.length === 1 ? "voicemail" : "confirmed",
      ),
    );
  const first = await service.dispatchJob(newer, "owner");
  assert.equal(first.decision.disposition, "unreached");
  const second = await service.dispatchJob(older, "owner");
  assert.equal(second.decision.billing, "reported_off_rent");
  assert.ok(second.decisionOrder > first.decisionOrder);
  second.updatedAt = first.updatedAt;
  await store.saveJob(second);
  const summary = decision.summarizeRentals(
    [r],
    await store.jobsFor(r.workspaceId),
  );
  assert.equal(
    summary.confirmed,
    1,
    "Newest actual confirmation must not be masked by an older call from a newer preview",
  );
});
// Regression cases discovered and fixed during independent review.
await test("Reference must be an off-rent reference, not collection ticket", async () =>
  denyConfirmation((c, e) => {
    e.reference_quote = "The collection ticket is OR-78416.";
    c.recipients[0].attempts[0].transcriptTurns[5].text = e.reference_quote;
  }));
await test("Affirmative readback cannot relabel a collection ticket as off-rent", async () =>
  denyConfirmation((c, e) => {
    e.reference_quote = "Yes, correct. The collection ticket is OR-78416.";
    e.readback_quote = e.reference_quote;
    c.recipients[0].attempts[0].transcriptTurns[5].text = e.reference_quote;
  }));
await test("Negated confirmation with bare no is rejected", async () =>
  denyConfirmation((c, e) => {
    e.billing_quote =
      "No. Billing stops on September 14, 2026 at 3:00 PM Central Daylight Time?";
    c.recipients[0].attempts[0].transcriptTurns[3].text = e.billing_quote;
  }));
await test("Unspoken seconds cannot be invented in extracted cutoff", async () =>
  denyConfirmation((c, e) => {
    e.off_rent_at = "2026-09-14T15:00:59-05:00";
  }));
await test("Cutoff cannot borrow date from request and time from pickup", async () =>
  denyConfirmation((c, e) => {
    e.billing_quote =
      "The billing stops at 5:00 PM Central Daylight Time on September 14, 2026. Your pickup is at 3:00 PM Central Daylight Time.";
    c.recipients[0].attempts[0].transcriptTurns[3].text = e.billing_quote;
  }));
fs.writeFileSync(
  path.join(scratch, "regression-results.json"),
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      sourceFiles: [
        "lib/server/service.ts",
        "lib/server/store.ts",
        "lib/server/provider.ts",
        "lib/offhire/decision.ts",
        "lib/offhire/evidence.ts",
        "app/api/[...path]/route.ts",
      ],
      results: report,
    },
    null,
    2,
  ),
);
console.log(
  `\n${report.filter((r) => r.status === "passed").length}/${report.length} passed. Zero live network requests.`,
);
if (db) db.close();
process.exitCode = report.some((r) => r.status === "failed") ? 1 : 0;
