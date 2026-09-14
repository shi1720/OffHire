import { createHash } from "node:crypto";
import {
  getFirestore,
  type Firestore,
  type DocumentSnapshot,
  type Transaction,
  type DocumentReference,
} from "firebase-admin/firestore";
import { firebaseAdminApp } from "./firebase-admin";
import type { Job, Rental } from "../offhire/types";
import type { AuditEntry, DispatchClaim, Persistence } from "./persistence";

const closed = new Set(["completed", "failed", "canceled", "expired"]);
const key = (id: string) => createHash("sha256").update(id).digest("hex");
const json = (value: unknown): string => {
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, "utf8") > 900_000)
    throw new Error(
      "This record exceeds the supported evidence size. Keep the saved call ID and contact support.",
    );
  return result;
};
const payload = <T>(snapshot: DocumentSnapshot): T | null =>
  snapshot.exists ? (JSON.parse(snapshot.get("payload")) as T) : null;
const jobData = (job: Job) => ({
  id: job.id,
  workspace_id: job.workspaceId,
  rental_id: job.rentalId,
  status: job.status,
  mode: job.mode,
  call_id: job.callId,
  payload: json(job),
  created_at: job.createdAt,
  updated_at: job.updatedAt,
});
const rentalData = (rental: Rental) => ({
  id: rental.id,
  workspace_id: rental.workspaceId,
  payload: json(rental),
  created_at: rental.createdAt,
});

/** Server-only Firestore repository. Never uses the browser SDK or local files. */
export class FirestorePersistence implements Persistence {
  constructor(
    private readonly db: Firestore,
    private readonly prefix = "offhire",
  ) {}
  private collection(name: string) {
    return this.db.collection(`${this.prefix}_${name}`);
  }
  private workspace(id: string) {
    return this.collection("workspaces").doc(key(id));
  }
  private job(id: string) {
    return this.collection("jobs").doc(key(id));
  }
  private rental(id: string) {
    return this.collection("rentals").doc(key(id));
  }
  private lock() {
    return this.collection("dispatch_locks").doc("calle-account");
  }
  private budget() {
    return this.collection("meta").doc("calle-account");
  }
  private reservation(id: string) {
    return this.collection("usage_reservations").doc(key(id));
  }
  private call(id: string) {
    return this.collection("call_ids").doc(key(id));
  }
  private audits(id: string) {
    return this.workspace(id).collection("audit");
  }

  async rentalsFor(workspace: string): Promise<Rental[]> {
    const rows = await this.collection("rentals")
      .where("workspace_id", "==", workspace)
      .get();
    return rows.docs
      .map((doc) => payload<Rental>(doc)!)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async jobsFor(workspace: string): Promise<Job[]> {
    const rows = await this.collection("jobs")
      .where("workspace_id", "==", workspace)
      .get();
    return rows.docs
      .map((doc) => payload<Job>(doc)!)
      .sort(
        (a, b) =>
          (b.decisionOrder ?? 0) - (a.decisionOrder ?? 0) ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }
  async getRental(id: string, workspace: string): Promise<Rental | null> {
    const rental = payload<Rental>(await this.rental(id).get());
    return rental?.workspaceId === workspace ? rental : null;
  }
  async getJob(id: string, workspace?: string): Promise<Job | null> {
    const job = payload<Job>(await this.job(id).get());
    return job && (!workspace || job.workspaceId === workspace) ? job : null;
  }
  async saveRental(rental: Rental): Promise<void> {
    const data = rentalData(rental);
    await this.db.runTransaction(async (tx) => {
      const [workspace, current] = await tx.getAll(
        this.workspace(rental.workspaceId),
        this.rental(rental.id),
      );
      if (!workspace.exists) throw new Error("Workspace is missing.");
      if (current.exists && current.get("workspace_id") !== rental.workspaceId)
        throw new Error("Rental belongs to another workspace.");
      tx.set(this.rental(rental.id), data);
    });
  }
  private async checkCall(
    tx: Transaction,
    job: Job,
  ): Promise<DocumentReference | null> {
    if (!job.callId) return null;
    const ref = this.call(job.callId);
    const existing = await tx.get(ref);
    if (existing.exists && existing.get("job_id") !== job.id)
      throw new Error("This provider call is already attached to another job.");
    return ref;
  }
  private writeJob(
    tx: Transaction,
    job: Job,
    callRef: DocumentReference | null,
  ): void {
    tx.set(this.job(job.id), jobData(job));
    if (callRef) tx.set(callRef, { call_id: job.callId, job_id: job.id });
  }
  async saveJob(job: Job): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const [workspace, rental, current] = await tx.getAll(
        this.workspace(job.workspaceId),
        this.rental(job.rentalId),
        this.job(job.id),
      );
      const callRef = await this.checkCall(tx, job);
      if (
        !workspace.exists ||
        workspace.get("mode") !== job.mode ||
        rental.get("workspace_id") !== job.workspaceId
      )
        throw new Error("Job workspace or rental is missing or mismatched.");
      if (
        current.exists &&
        (current.get("workspace_id") !== job.workspaceId ||
          current.get("rental_id") !== job.rentalId)
      )
        throw new Error("Job identity cannot change.");
      const saved = payload<Job>(current);
      if (saved?.callId && saved.callId !== job.callId)
        throw new Error("A saved provider call ID cannot change.");
      this.writeJob(tx, job, callRef);
    });
  }
  async compareAndSaveJob(previous: Job, next: Job): Promise<boolean> {
    if (
      previous.id !== next.id ||
      previous.workspaceId !== next.workspaceId ||
      previous.rentalId !== next.rentalId ||
      previous.mode !== next.mode ||
      previous.requestJson !== next.requestJson ||
      previous.idempotencyKey !== next.idempotencyKey
    )
      throw new Error("Job identity and the reviewed request cannot change.");
    const result = await this.db.runTransaction(async (tx) => {
      const [current, workspace, lock] = await tx.getAll(
        this.job(previous.id),
        this.workspace(previous.workspaceId),
        this.lock(),
      );
      const saved = payload<Job>(current);
      if (!saved || current.get("payload") !== JSON.stringify(previous)) {
        // Repair a pre-existing terminal orphan even when the supplied poll is stale.
        if (
          saved &&
          closed.has(saved.status) &&
          lock.get("job_id") === saved.id
        )
          tx.delete(this.lock());
        return { changed: false, order: undefined as number | undefined };
      }
      if (!workspace.exists) throw new Error("Workspace is missing.");
      if (saved.callId && saved.callId !== next.callId)
        throw new Error("A saved provider call ID cannot change.");
      const callRef = await this.checkCall(tx, next);
      const committing = { ...next };
      if (committing.decision && !previous.decision) {
        committing.decisionOrder =
          Number(workspace.get("decision_sequence") ?? 0) + 1;
        tx.update(this.workspace(next.workspaceId), {
          decision_sequence: committing.decisionOrder,
        });
      }
      this.writeJob(tx, committing, callRef);
      if (closed.has(committing.status) && lock.get("job_id") === committing.id)
        tx.delete(this.lock());
      return { changed: true, order: committing.decisionOrder };
    });
    if (result.changed && result.order !== undefined)
      next.decisionOrder = result.order;
    return result.changed;
  }
  async releaseTerminalLock(jobId: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const [job, lock] = await tx.getAll(this.job(jobId), this.lock());
      if (
        job.exists &&
        closed.has(job.get("status")) &&
        lock.get("job_id") === jobId
      )
        tx.delete(this.lock());
    });
  }
  async claimDispatch(
    previous: Job,
    next: Job,
    limit: number,
  ): Promise<DispatchClaim> {
    const result = await this.db.runTransaction(async (tx) => {
      const [current, workspace, lock, reservation, budget] = await tx.getAll(
        this.job(previous.id),
        this.workspace(previous.workspaceId),
        this.lock(),
        this.reservation(previous.id),
        this.budget(),
      );
      const now = new Date().toISOString();
      if (
        !workspace.exists ||
        workspace.get("mode") !== "live" ||
        previous.mode !== "live" ||
        !["prepared", "dispatch_uncertain"].includes(previous.status) ||
        current.get("payload") !== JSON.stringify(previous) ||
        previous.grantExpiresAt <= now
      )
        return { status: "stale" as DispatchClaim, updatedAt: now };
      if (lock.exists && lock.get("job_id") !== previous.id)
        return { status: "busy" as DispatchClaim, updatedAt: now };
      const used = Number(budget.get("used") ?? 0);
      if (!reservation.exists && used >= Math.max(0, Math.floor(limit))) {
        if (lock.get("job_id") === previous.id) tx.delete(this.lock());
        return { status: "budget_exhausted" as DispatchClaim, updatedAt: now };
      }
      const committing = {
        ...next,
        status: "dispatching" as const,
        updatedAt: now,
      };
      if (
        committing.id !== previous.id ||
        committing.workspaceId !== previous.workspaceId ||
        committing.rentalId !== previous.rentalId ||
        committing.requestJson !== previous.requestJson ||
        committing.idempotencyKey !== previous.idempotencyKey
      )
        throw new Error("The reviewed dispatch request cannot change.");
      tx.set(this.lock(), { job_id: previous.id });
      if (!reservation.exists) {
        tx.create(this.reservation(previous.id), {
          job_id: previous.id,
          used: 1,
          created_at: now,
        });
        tx.set(this.budget(), { used: used + 1 });
      }
      tx.set(this.job(previous.id), jobData(committing));
      return { status: "claimed" as DispatchClaim, updatedAt: now };
    });
    if (result.status === "claimed") next.updatedAt = result.updatedAt;
    return result.status;
  }
  private checkSeed(
    id: string,
    mode: "demo" | "live",
    rentals: Rental[],
    jobs: Job[],
  ): void {
    if (
      rentals.some((r) => r.workspaceId !== id) ||
      jobs.some(
        (j) =>
          j.workspaceId !== id ||
          j.mode !== mode ||
          !rentals.some((r) => r.id === j.rentalId),
      )
    )
      throw new Error("Seed records do not match their workspace.");
    if (rentals.length > 50 || jobs.length > 200)
      throw new Error("Workspace seed exceeds the supported size.");
    if (
      new Set(rentals.map((r) => r.id)).size !== rentals.length ||
      new Set(jobs.map((j) => j.id)).size !== jobs.length ||
      new Set(jobs.filter((j) => j.callId).map((j) => j.callId)).size !==
        jobs.filter((j) => j.callId).length
    )
      throw new Error("Workspace seed identifiers must be unique.");
  }
  private seed(
    tx: Transaction,
    rentals: Rental[],
    jobs: Job[],
    startOrder: number,
  ): number {
    let order = startOrder;
    for (const rental of rentals)
      tx.set(this.rental(rental.id), rentalData(rental));
    for (const job of jobs) {
      const saved = { ...job };
      if (saved.decision) saved.decisionOrder = ++order;
      this.writeJob(tx, saved, saved.callId ? this.call(saved.callId) : null);
    }
    return order;
  }
  async ensureWorkspace(
    id: string,
    mode: "demo" | "live",
    rentals: Rental[],
    jobs: Job[],
  ): Promise<void> {
    this.checkSeed(id, mode, rentals, jobs);
    await this.db.runTransaction(async (tx) => {
      const workspace = await tx.get(this.workspace(id));
      if (workspace.exists) {
        if (workspace.get("mode") !== mode)
          throw new Error("Workspace mode cannot change.");
        return;
      }
      const targets = [
        ...rentals.map((r) => this.rental(r.id)),
        ...jobs.map((j) => this.job(j.id)),
        ...jobs.filter((j) => j.callId).map((j) => this.call(j.callId!)),
      ];
      if (
        targets.length &&
        (await tx.getAll(...targets)).some((doc) => doc.exists)
      )
        throw new Error("Workspace seed identifiers already exist.");
      const now = new Date();
      const sequence = this.seed(tx, rentals, jobs, 0);
      tx.create(this.workspace(id), {
        id,
        mode,
        created_at: now.toISOString(),
        expires_at:
          mode === "demo"
            ? new Date(now.getTime() + 7 * 86400000).toISOString()
            : null,
        decision_sequence: sequence,
        revision: 0,
      });
    });
  }
  async resetWorkspace(
    id: string,
    rentals: Rental[],
    jobs: Job[],
  ): Promise<void> {
    this.checkSeed(id, "demo", rentals, jobs);
    await this.db.runTransaction(async (tx) => {
      const [workspace, lock] = await tx.getAll(
        this.workspace(id),
        this.lock(),
      );
      if (workspace.get("mode") !== "demo")
        throw new Error("Only a demo workspace can be reset.");
      const [oldRentals, oldJobs, audit] = await Promise.all([
        tx.get(this.collection("rentals").where("workspace_id", "==", id)),
        tx.get(this.collection("jobs").where("workspace_id", "==", id)),
        tx.get(this.audits(id)),
      ]);
      const targets = [
        ...rentals.map((r) => this.rental(r.id)),
        ...jobs.map((j) => this.job(j.id)),
      ];
      if (
        targets.length &&
        (await tx.getAll(...targets)).some(
          (doc) => doc.exists && doc.get("workspace_id") !== id,
        )
      )
        throw new Error(
          "Workspace seed identifiers belong to another workspace.",
        );
      const callRefs = jobs
        .filter((j) => j.callId)
        .map((j) => this.call(j.callId!));
      const oldJobIds = new Set(oldJobs.docs.map((doc) => doc.get("id")));
      if (
        callRefs.length &&
        (await tx.getAll(...callRefs)).some(
          (doc) => doc.exists && !oldJobIds.has(doc.get("job_id")),
        )
      )
        throw new Error(
          "Workspace seed provider calls belong to another workspace.",
        );
      // Fail before any write if a reset cannot fit safely in Firestore's 10 MiB transaction.
      const bytes = [...oldRentals.docs, ...oldJobs.docs, ...audit.docs].reduce(
        (sum, doc) =>
          sum + Buffer.byteLength(JSON.stringify(doc.data()), "utf8"),
        0,
      );
      if (bytes > 8_000_000)
        throw new Error(
          "This workspace is too large for an atomic reset. Export records and create a new demo workspace.",
        );
      if (oldJobs.docs.some((doc) => doc.get("mode") !== "demo"))
        throw new Error("Live evidence cannot be reset.");
      for (const doc of [...oldJobs.docs, ...oldRentals.docs, ...audit.docs])
        tx.delete(doc.ref);
      for (const doc of oldJobs.docs)
        if (doc.get("call_id")) tx.delete(this.call(doc.get("call_id")));
      if (oldJobs.docs.some((doc) => doc.get("id") === lock.get("job_id")))
        tx.delete(this.lock());
      const sequence = this.seed(
        tx,
        rentals,
        jobs,
        Number(workspace.get("decision_sequence") ?? 0),
      );
      tx.update(this.workspace(id), {
        decision_sequence: sequence,
        revision: Number(workspace.get("revision") ?? 0) + 1,
      });
    });
  }
  async recordAudit(
    workspace: string,
    rental: string | null,
    action: string,
    detail: string,
  ): Promise<void> {
    const ref = this.audits(workspace).doc();
    await this.db.runTransaction(async (tx) => {
      if (!(await tx.get(this.workspace(workspace))).exists)
        throw new Error("Workspace is missing.");
      tx.create(ref, {
        action,
        detail,
        created_at: new Date().toISOString(),
        rental_id: rental,
      });
    });
  }
  async auditFor(workspace: string, limit = 100): Promise<AuditEntry[]> {
    const rows = await this.audits(workspace)
      .orderBy("created_at", "desc")
      .limit(Math.max(1, Math.min(500, Math.floor(limit))))
      .get();
    return rows.docs.map((doc) => doc.data() as AuditEntry);
  }
  async getJobByCallId(callId: string): Promise<Job | null> {
    const map = await this.call(callId).get();
    if (!map.exists) return null;
    const job = await this.getJob(map.get("job_id"));
    return job?.mode === "live" && job.callId === callId ? job : null;
  }
  async hasWebhookEvent(eventId: string): Promise<boolean> {
    return (await this.collection("events").doc(key(eventId)).get()).exists;
  }
  async recordWebhookEvent(eventId: string, jobId: string): Promise<void> {
    const ref = this.collection("events").doc(key(eventId));
    await this.db.runTransaction(async (tx) => {
      const [event, job] = await tx.getAll(ref, this.job(jobId));
      if (event.exists) return;
      if (
        !job.exists ||
        !["completed", "failed", "canceled"].includes(job.get("status"))
      )
        throw new Error(
          "The provider call must be reconciled before acknowledging its event.",
        );
      tx.create(ref, {
        id: eventId,
        job_id: jobId,
        created_at: new Date().toISOString(),
      });
    });
  }
  async usageCount(): Promise<number> {
    return Number((await this.budget().get()).get("used") ?? 0);
  }
}

let instance: FirestorePersistence | undefined;
export function firestoreStore(): FirestorePersistence {
  return (instance ??= new FirestorePersistence(
    getFirestore(firebaseAdminApp()),
  ));
}
