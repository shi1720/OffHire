/** Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx --test tests/firestore/persistence.test.ts */
import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FirestorePersistence } from "../../lib/server/firestore-store";
import { demoRentals, fixtureCall } from "../../lib/offhire/fixtures";
import { reconcileCall } from "../../lib/offhire/decision";
import type { Job, Rental } from "../../lib/offhire/types";

const host = process.env.FIRESTORE_EMULATOR_HOST;
// The demo project needs no cloud credentials or metadata-server discovery.
if (host) process.env.METADATA_SERVER_DETECTION = "none";
if (host && !/^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host))
  throw new Error(
    "Persistence tests require a loopback Firestore emulator; refusing another host.",
  );
const clone = <T>(value: T): T => structuredClone(value);
const docKey = (id: string) => createHash("sha256").update(id).digest("hex");

describe(
  "Firestore persistence against the real local emulator",
  {
    skip: !host
      ? "FIRESTORE_EMULATOR_HOST is required; no production fallback"
      : false,
    concurrency: false,
  },
  () => {
    let app: App,
      db: Firestore,
      store: FirestorePersistence,
      prefix: string,
      rental: Rental;
    const collection = (name: string) => db.collection(`${prefix}_${name}`);
    const lock = () => collection("dispatch_locks").doc("calle-account");
    const prepare = async (r = rental): Promise<Job> => {
      const now = new Date().toISOString();
      const id = randomUUID();
      const j: Job = {
        id,
        workspaceId: r.workspaceId,
        rentalId: r.id,
        mode: "live",
        status: "prepared",
        idempotencyKey: `offhire:${id}:v1`,
        requestJson: JSON.stringify({
          task: "Local persistence test; never sent",
          recipients: [],
        }),
        scenario: "confirmed",
        callId: null,
        createdAt: now,
        updatedAt: now,
        grantExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        approvedBy: null,
        decision: null,
        snapshot: null,
        error: null,
        nextCheckAt: null,
      };
      await store.saveJob(j);
      return j;
    };
    const claim = async (j: Job, limit = 5) => {
      const next: Job = {
        ...j,
        status: "dispatching",
        approvedBy: "Local test owner",
        updatedAt: new Date().toISOString(),
      };
      const result = await store.claimDispatch(j, next, limit);
      return { result, next };
    };
    const complete = async (j: Job, r = rental) => {
      const snapshot = fixtureCall(r, "confirmed", `sim-${j.id}`);
      const next: Job = {
        ...j,
        callId: snapshot.id,
        status: "completed",
        snapshot,
        decision: reconcileCall(snapshot, r),
        updatedAt: "2026-09-14T10:00:00.000Z",
      };
      assert.equal(await store.compareAndSaveJob(j, next), true);
      return next;
    };
    before(() => {
      app = initializeApp(
        { projectId: "demo-offhire" },
        `offhire-persistence-${process.pid}`,
      );
      db = getFirestore(app);
    });
    beforeEach(async () => {
      prefix = `offhire_test_${randomUUID().replaceAll("-", "")}`;
      store = new FirestorePersistence(db, prefix);
      const workspace = randomUUID();
      await store.ensureWorkspace(workspace, "live", [], []);
      rental = {
        ...demoRentals(workspace)[0],
        phone: "+12025550123",
        authorizedContact: true,
        isTest: true,
      };
      await store.saveRental(rental);
    });
    afterEach(async () => {
      for (const ref of await db.listCollections())
        if (ref.id.startsWith(`${prefix}_`)) await db.recursiveDelete(ref);
    });
    after(async () => {
      await db.terminate();
      await deleteApp(app);
    });

    test("concurrent identical dispatches win once and reserve once", async () => {
      const j = await prepare();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => claim(clone(j))),
      );
      assert.equal(results.filter((r) => r.result === "claimed").length, 1);
      assert.equal(results.filter((r) => r.result === "stale").length, 7);
      assert.equal(await store.usageCount(), 1);
      assert.equal((await collection("usage_reservations").get()).size, 1);
      assert.equal((await lock().get()).get("job_id"), j.id);
    });
    test("different workspaces share one account-wide live lock", async () => {
      const workspace = randomUUID();
      await store.ensureWorkspace(workspace, "live", [], []);
      const other = { ...rental, id: randomUUID(), workspaceId: workspace };
      await store.saveRental(other);
      const jobs = [await prepare(), await prepare(other)];
      const results = await Promise.all(jobs.map((j) => claim(j)));
      assert.deepEqual(results.map((r) => r.result).sort(), [
        "busy",
        "claimed",
      ]);
      assert.equal(await store.usageCount(), 1);
    });
    test("uncertain replay preserves request, idempotency key and original reservation", async () => {
      const j = await prepare();
      const first = await claim(j);
      const uncertain: Job = {
        ...first.next,
        status: "dispatch_uncertain",
        error: "Simulated transport loss",
      };
      assert.equal(await store.compareAndSaveJob(first.next, uncertain), true);
      assert.equal((await lock().get()).get("job_id"), j.id);
      const replay = await claim(uncertain, 0);
      assert.equal(
        replay.result,
        "claimed",
        "An existing reservation can replay despite a subsequently lowered cap",
      );
      assert.equal(replay.next.requestJson, j.requestJson);
      assert.equal(replay.next.idempotencyKey, j.idempotencyKey);
      assert.equal(await store.usageCount(), 1);
    });
    test("a changed frozen request cannot claim an uncertain replay", async () => {
      const j = await prepare();
      const next: Job = { ...j, status: "dispatching", requestJson: "{}" };
      await assert.rejects(
        store.claimDispatch(j, next, 5),
        /reviewed dispatch request/,
      );
      assert.equal((await store.getJob(j.id))?.status, "prepared");
      assert.equal(await store.usageCount(), 0);
      assert.equal((await lock().get()).exists, false);
    });
    test("budget is immutable per job and a full cap does not leave an orphan lock", async () => {
      const first = await claim(await prepare(), 1);
      await complete(first.next);
      const second = await prepare();
      assert.equal((await claim(second, 1)).result, "budget_exhausted");
      assert.equal((await lock().get()).exists, false);
      assert.equal((await store.getJob(second.id))?.status, "prepared");
      assert.equal(await store.usageCount(), 1);
      assert.equal((await claim(second, 2)).result, "claimed");
      assert.equal(await store.usageCount(), 2);
    });
    test("expired prepared jobs cannot reserve budget or acquire account capacity", async () => {
      const j = await prepare();
      j.grantExpiresAt = new Date(Date.now() - 1_000).toISOString();
      await store.saveJob(j);
      assert.equal((await claim(j)).result, "stale");
      assert.equal(await store.usageCount(), 0);
      assert.equal((await lock().get()).exists, false);
    });
    test("expiry recovery releases a prepared orphan atomically", async () => {
      const j = await prepare();
      await lock().set({ job_id: j.id });
      const expired: Job = { ...j, status: "expired" };
      assert.equal(await store.compareAndSaveJob(j, expired), true);
      assert.equal((await store.getJob(j.id))?.status, "expired");
      assert.equal((await lock().get()).exists, false);
    });
    test("expired uncertain submission retains its lock and never reserves another unit", async () => {
      const first = await claim(await prepare());
      const uncertain: Job = {
        ...first.next,
        status: "dispatch_uncertain",
        grantExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      };
      assert.equal(await store.compareAndSaveJob(first.next, uncertain), true);
      assert.equal((await claim(uncertain)).result, "stale");
      await store.releaseTerminalLock(uncertain.id);
      assert.equal((await lock().get()).get("job_id"), uncertain.id);
      assert.equal(await store.usageCount(), 1);
    });
    test("terminal receipt and lock release commit together; stale poll cannot regress either", async () => {
      const first = await claim(await prepare());
      const queued: Job = {
        ...first.next,
        status: "queued",
        callId: `sim-${first.next.id}`,
      };
      assert.equal(await store.compareAndSaveJob(first.next, queued), true);
      const receipt = await complete(queued);
      const stale: Job = {
        ...queued,
        status: "in_progress",
        decision: null,
        snapshot: null,
      };
      assert.equal(await store.compareAndSaveJob(queued, stale), false);
      const saved = await store.getJob(queued.id);
      assert.equal(saved?.status, "completed");
      assert.deepEqual(saved?.decision, receipt.decision);
      assert.equal((await lock().get()).exists, false);
    });
    test("decision order is monotonic even when timestamps tie or move backward", async () => {
      const jobs = await Promise.all([prepare(), prepare(), prepare()]);
      const results = await Promise.all(jobs.map((j) => complete(j)));
      assert.deepEqual(results.map((j) => j.decisionOrder).sort(), [1, 2, 3]);
      const saved = await store.jobsFor(rental.workspaceId);
      assert.deepEqual(
        saved.map((j) => j.decisionOrder),
        [3, 2, 1],
      );
    });
    test("terminal orphan recovery cannot release a different job's lock", async () => {
      const done = await complete(await prepare());
      const active = await claim(await prepare());
      await store.releaseTerminalLock(done.id);
      assert.equal((await lock().get()).get("job_id"), active.next.id);
      await lock().set({ job_id: done.id });
      await store.releaseTerminalLock(done.id);
      assert.equal((await lock().get()).exists, false);
    });
    test("provider call IDs are unique and scoped reads do not leak a different workspace", async () => {
      const first = await complete(await prepare());
      const second = await prepare();
      await assert.rejects(
        store.compareAndSaveJob(second, { ...second, callId: first.callId }),
        /already attached/,
      );
      assert.equal((await store.getJob(second.id))?.callId, null);
      assert.equal(await store.getJob(first.id, "another-workspace"), null);
      assert.equal(await store.getRental(rental.id, "another-workspace"), null);
      assert.equal((await store.getJobByCallId(first.callId!))?.id, first.id);
    });
    test("webhook acknowledgement waits for terminal reconciliation and deduplicates repeated events", async () => {
      const j = await prepare();
      const event = "event/with/untrusted/slashes";
      await assert.rejects(store.recordWebhookEvent(event, j.id), /reconciled/);
      assert.equal(await store.hasWebhookEvent(event), false);
      await complete(j);
      await Promise.all(
        Array.from({ length: 5 }, () => store.recordWebhookEvent(event, j.id)),
      );
      assert.equal(await store.hasWebhookEvent(event), true);
      assert.equal((await collection("events").get()).size, 1);
    });
    test("concurrent demo initialization produces a complete single seed", async () => {
      const workspace = randomUUID();
      const rentals = demoRentals(workspace);
      const jobs: Job[] = [];
      await Promise.all(
        Array.from({ length: 5 }, () =>
          store.ensureWorkspace(workspace, "demo", rentals, jobs),
        ),
      );
      assert.equal((await store.rentalsFor(workspace)).length, 3);
      assert.equal((await store.jobsFor(workspace)).length, 0);
      await assert.rejects(
        store.ensureWorkspace(workspace, "live", [], []),
        /mode cannot change/,
      );
    });
    test("demo reset removes rental changes and audits atomically without touching live capacity", async () => {
      const active = await claim(await prepare());
      const workspace = randomUUID();
      const rentals = demoRentals(workspace);
      await store.ensureWorkspace(workspace, "demo", rentals, []);
      await store.saveRental({ ...rentals[0], writtenConfirmation: true });
      await store.recordAudit(
        workspace,
        rentals[0].id,
        "test",
        "changed fixture",
      );
      await store.resetWorkspace(workspace, rentals, []);
      assert.equal(
        (await store.getRental(rentals[0].id, workspace))?.writtenConfirmation,
        false,
      );
      assert.deepEqual(await store.auditFor(workspace), []);
      assert.equal((await store.rentalsFor(workspace)).length, 3);
      assert.equal((await lock().get()).get("job_id"), active.next.id);
      await assert.rejects(
        store.resetWorkspace(rental.workspaceId, [], []),
        /Only a demo/,
      );
      assert.equal((await store.getJob(active.next.id))?.status, "dispatching");
    });
    test("reset replaces seeded receipts and call indexes with monotonically ordered fixtures", async () => {
      const workspace = randomUUID();
      const rentals = demoRentals(workspace);
      const template = await prepare();
      const seeds: Job[] = rentals.slice(1).map((r, index) => {
        const snapshot = fixtureCall(
          r,
          index === 0 ? "ambiguous" : "confirmed",
          `sim-seed-${r.id}`,
        );
        return {
          ...template,
          id: `seed-${r.id}`,
          workspaceId: workspace,
          rentalId: r.id,
          mode: "demo",
          status: "completed",
          callId: snapshot.id,
          snapshot,
          decision: reconcileCall(snapshot, r),
          idempotencyKey: `seed-${r.id}`,
        };
      });
      await store.ensureWorkspace(workspace, "demo", rentals, seeds);
      assert.deepEqual(
        (await store.jobsFor(workspace)).map((j) => j.decisionOrder),
        [2, 1],
      );
      await store.recordAudit(workspace, null, "before-reset", "synthetic");
      await store.resetWorkspace(workspace, rentals, seeds);
      assert.deepEqual(
        (await store.jobsFor(workspace)).map((j) => j.decisionOrder),
        [4, 3],
      );
      assert.equal(
        (await collection("call_ids").where("job_id", "==", seeds[0].id).get())
          .size,
        1,
      );
      assert.deepEqual(await store.auditFor(workspace), []);
    });
    test("reset refuses foreign rental identifiers before changing any records", async () => {
      const workspace = randomUUID();
      const rentals = demoRentals(workspace);
      await store.ensureWorkspace(workspace, "demo", rentals, []);
      await assert.rejects(
        store.resetWorkspace(workspace, [{ ...rentals[0], id: rental.id }], []),
        /another workspace/,
      );
      assert.equal((await store.rentalsFor(workspace)).length, 3);
      assert.equal(
        (await store.getRental(rental.id, rental.workspaceId))?.id,
        rental.id,
      );
    });
    test("oversized evidence fails closed without saving a receipt or releasing a live lock", async () => {
      const first = await claim(await prepare());
      const next: Job = {
        ...first.next,
        status: "completed",
        error: "x".repeat(900_001),
      };
      await assert.rejects(
        store.compareAndSaveJob(first.next, next),
        /evidence size/,
      );
      assert.equal((await store.getJob(first.next.id))?.status, "dispatching");
      assert.equal((await lock().get()).get("job_id"), first.next.id);
    });
    test("transaction retry does not persist a losing compare-and-swap payload", async () => {
      const j = await prepare();
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          store.compareAndSaveJob(clone(j), { ...j, error: `candidate-${i}` }),
        ),
      );
      assert.equal(outcomes.filter(Boolean).length, 1);
      const winner = outcomes.findIndex(Boolean);
      assert.equal((await store.getJob(j.id))?.error, `candidate-${winner}`);
    });
    test("audit retrieval is scoped, ordered and bounded", async () => {
      await store.recordAudit(rental.workspaceId, rental.id, "first", "one");
      await store.recordAudit(rental.workspaceId, rental.id, "second", "two");
      assert.equal(
        (await store.auditFor(rental.workspaceId, 1))[0].action,
        "second",
      );
      assert.deepEqual(await store.auditFor("missing-workspace"), []);
      assert.equal(
        (
          await collection("workspaces").doc(docKey(rental.workspaceId)).get()
        ).get("mode"),
        "live",
      );
    });
  },
);
