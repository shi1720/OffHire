// Exercises the real HTTP routes and local D1. Never supplies live credentials.
import assert from "node:assert/strict";
const origin = process.argv[2] || "http://localhost:5173";
let cookie = "";
let checks = 0;
async function request(path, data, options = {}) {
  const r = await fetch(`${origin}/api/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }
  return { status: r.status, body };
}
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
};
let state = await request("state");
ok(state.status === 200, "state loads");
ok(state.body.rentals.length === 3, "three seeded rentals");
ok(state.body.jobs.length === 2, "two seeded evidence records");
const workspaceCookie = cookie;
const rental = state.body.rentals[0];
const plan = await request(`rentals/${rental.id}/plan`, {
  scenario: "confirmed",
});
ok(plan.status === 201, "plan freezes");
ok(plan.body.plan.task.includes("existing off-rent request"), "bounded task");
let dispatch = await request(`jobs/${plan.body.job.id}/dispatch`, {});
ok(dispatch.status === 403, "approval required");
dispatch = await request(`jobs/${plan.body.job.id}/dispatch`, {
  approved: true,
});
ok(dispatch.status === 200, "demo dispatch succeeds");
ok(
  dispatch.body.job.decision.billing === "reported_off_rent",
  "engine accepts full evidence",
);
const repeated = await request(`jobs/${plan.body.job.id}/dispatch`, {
  approved: true,
});
ok(
  repeated.body.job.callId === dispatch.body.job.callId,
  "duplicate dispatch retains call ID",
);
state = await request("state");
ok(
  state.body.jobs.filter((j) => j.rentalId === rental.id).length === 1,
  "one durable job",
);
const replan = await request(`rentals/${rental.id}/plan`, {
  scenario: "confirmed",
});
ok(replan.status === 409, "confirmed rentals are not redialed");
const invoice = await request(`rentals/${rental.id}/invoice`, {
  billedThrough: "2026-09-15",
});
ok(invoice.body.flagged === true, "invoice discrepancy flagged");
const badDate = await request(`rentals/${rental.id}/invoice`, {
  billedThrough: "2026-02-31",
});
ok(badDate.status >= 400, "impossible date rejected");
const recorded = await request(`rentals/${rental.id}/record`, {
  action: "collected",
  note: "Synthetic QA: site lead recorded physical pickup.",
});
ok(recorded.body.rental.collectedAt, "pickup recorded independently");
const exportData = await request("export");
ok(
  exportData.body.mode === "demo",
  "export explicitly labels synthetic evidence",
);
ok(
  exportData.body.audit.some((e) => e.action === "collected"),
  "audit trail exported",
);
ok(
  !JSON.stringify(exportData.body).includes("iams_live_"),
  "no API key in export",
);
const cross = await request(
  "reset",
  {},
  { headers: { Origin: "https://attacker.invalid" } },
);
ok(cross.status === 403, "cross-origin write blocked");
cookie = "";
const other = await request("state");
ok(
  other.body.rentals[0].id !== rental.id,
  "separate sessions have isolated data",
);
const forbidden = await request(`rentals/${rental.id}/record`, {
  action: "collected",
  note: "Should be blocked",
});
ok(forbidden.status === 404, "cannot mutate another workspace");
cookie = workspaceCookie;
const live = await request("state?mode=live");
ok(live.status === 403, "anonymous cannot read live state");
const spoof = await request("webhooks/calle/wrong-token", {
  id: "fake",
  type: "call.completed",
  data: { id: "fake" },
});
ok(spoof.status === 404, "unknown callback token blocked");
const invalid = await request("rentals", { assetId: "x" });
ok(invalid.status === 400, "invalid input rejected");
await request("reset", {});
state = await request("state");
ok(
  state.body.rentals.length === 3 && state.body.jobs.length === 2,
  "reset returns coherent scenario",
);
console.log(`PASS: ${checks} HTTP/D1 checks. Demo data only; zero live calls.`);
