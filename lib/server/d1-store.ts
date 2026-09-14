import { env } from "cloudflare:workers";
import type { Job, Rental } from "../offhire/types";
import type { AuditEntry, DispatchClaim } from "./persistence";
export function database(): D1Database {
  if (!env.DB)
    throw new Error(
      "The rental database is unavailable. Please retry shortly.",
    );
  return env.DB;
}
export async function rentalsFor(workspace: string): Promise<Rental[]> {
  const rows = await database()
    .prepare(
      "SELECT payload FROM rentals WHERE workspace_id = ? ORDER BY created_at",
    )
    .bind(workspace)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload));
}
export async function jobsFor(workspace: string): Promise<Job[]> {
  const rows = await database()
    .prepare(
      "SELECT payload FROM jobs WHERE workspace_id = ? ORDER BY COALESCE(json_extract(payload, '$.decisionOrder'),0) DESC, updated_at DESC, created_at DESC",
    )
    .bind(workspace)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload));
}
export async function getRental(
  id: string,
  workspace: string,
): Promise<Rental | null> {
  const r = await database()
    .prepare("SELECT payload FROM rentals WHERE id = ? AND workspace_id = ?")
    .bind(id, workspace)
    .first<{ payload: string }>();
  return r ? JSON.parse(r.payload) : null;
}
export async function getJob(
  id: string,
  workspace?: string,
): Promise<Job | null> {
  const sql = workspace
    ? "SELECT payload FROM jobs WHERE id = ? AND workspace_id = ?"
    : "SELECT payload FROM jobs WHERE id = ?";
  const r = await database()
    .prepare(sql)
    .bind(...(workspace ? [id, workspace] : [id]))
    .first<{ payload: string }>();
  return r ? JSON.parse(r.payload) : null;
}
export async function saveRental(r: Rental) {
  await database()
    .prepare(
      "INSERT INTO rentals (id,workspace_id,payload,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    )
    .bind(r.id, r.workspaceId, JSON.stringify(r), r.createdAt)
    .run();
}
export async function saveJob(j: Job) {
  await database()
    .prepare(
      "INSERT INTO jobs (id,workspace_id,rental_id,status,mode,call_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,call_id=excluded.call_id,payload=excluded.payload,updated_at=excluded.updated_at",
    )
    .bind(
      j.id,
      j.workspaceId,
      j.rentalId,
      j.status,
      j.mode,
      j.callId,
      JSON.stringify(j),
      j.createdAt,
      j.updatedAt,
    )
    .run();
}
export function rentalStatement(r: Rental) {
  return database()
    .prepare(
      "INSERT INTO rentals (id,workspace_id,payload,created_at) VALUES (?,?,?,?)",
    )
    .bind(r.id, r.workspaceId, JSON.stringify(r), r.createdAt);
}
export function jobStatement(j: Job) {
  return database()
    .prepare(
      "INSERT INTO jobs (id,workspace_id,rental_id,status,mode,call_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      j.id,
      j.workspaceId,
      j.rentalId,
      j.status,
      j.mode,
      j.callId,
      JSON.stringify(j),
      j.createdAt,
      j.updatedAt,
    );
}
export async function recordAudit(
  workspaceId: string,
  rentalId: string | null,
  action: string,
  detail: string,
) {
  await database()
    .prepare(
      "INSERT INTO audit (id,workspace_id,rental_id,action,detail,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      workspaceId,
      rentalId,
      action,
      detail,
      new Date().toISOString(),
    )
    .run();
}
/** Compare the entire saved payload atomically. A stale poll cannot erase a receipt. */
export async function compareAndSaveJob(
  previous: Job,
  next: Job,
): Promise<boolean> {
  // Assign reconciliation order inside the winning SQL statement. Wall-clock
  // timestamps can tie within a millisecond or move backwards between workers.
  const update =
    next.decision && !previous.decision
      ? database()
          .prepare(
            "UPDATE jobs SET status=?,call_id=?,payload=json_set(?, '$.decisionOrder', (SELECT COALESCE(MAX(json_extract(payload, '$.decisionOrder')),0)+1 FROM jobs WHERE workspace_id=?)),updated_at=? WHERE id=? AND payload=?",
          )
          .bind(
            next.status,
            next.callId,
            JSON.stringify(next),
            next.workspaceId,
            next.updatedAt,
            next.id,
            JSON.stringify(previous),
          )
      : database()
          .prepare(
            "UPDATE jobs SET status=?,call_id=?,payload=?,updated_at=? WHERE id=? AND payload=?",
          )
          .bind(
            next.status,
            next.callId,
            JSON.stringify(next),
            next.updatedAt,
            next.id,
            JSON.stringify(previous),
          );
  const results = await database().batch([
    update,
    database()
      .prepare(
        "DELETE FROM dispatch_locks WHERE job_id=? AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status IN ('completed','failed','canceled','expired'))",
      )
      .bind(next.id, next.id),
  ]);
  const changed = !!results[0].meta.changes;
  if (changed && next.decision && !previous.decision) {
    const saved = await getJob(next.id, next.workspaceId);
    if (saved) next.decisionOrder = saved.decisionOrder;
  }
  return changed;
}
export async function releaseTerminalLock(jobId: string) {
  await database()
    .prepare(
      "DELETE FROM dispatch_locks WHERE job_id=? AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status IN ('completed','failed','canceled','expired'))",
    )
    .bind(jobId, jobId)
    .run();
}

export async function ensureWorkspace(
  id: string,
  mode: "demo" | "live",
  rentals: Rental[],
  jobs: Job[],
): Promise<void> {
  if (
    await database()
      .prepare("SELECT id FROM workspaces WHERE id = ?")
      .bind(id)
      .first()
  )
    return;
  const date = new Date().toISOString();
  try {
    await database().batch([
      database()
        .prepare(
          "INSERT OR IGNORE INTO workspaces (id,mode,created_at,expires_at) VALUES (?,?,?,?)",
        )
        .bind(
          id,
          mode,
          date,
          mode === "demo"
            ? new Date(Date.now() + 7 * 86400000).toISOString()
            : null,
        ),
      ...rentals.map(rentalStatement),
      ...jobs.map(jobStatement),
    ]);
  } catch (error) {
    if (
      !(await database()
        .prepare("SELECT id FROM workspaces WHERE id=?")
        .bind(id)
        .first())
    )
      throw error;
  }
}

export async function resetWorkspace(
  id: string,
  rentals: Rental[],
  jobs: Job[],
): Promise<void> {
  const workspace = await database()
    .prepare("SELECT mode FROM workspaces WHERE id=?")
    .bind(id)
    .first<{ mode: string }>();
  if (workspace?.mode !== "demo")
    throw new Error("Only a demo workspace can be reset.");
  await database().batch([
    database().prepare("DELETE FROM jobs WHERE workspace_id=?").bind(id),
    database().prepare("DELETE FROM rentals WHERE workspace_id=?").bind(id),
    database().prepare("DELETE FROM audit WHERE workspace_id=?").bind(id),
    ...rentals.map(rentalStatement),
    ...jobs.map(jobStatement),
  ]);
}

export async function claimDispatch(
  previous: Job,
  next: Job,
  limit: number,
): Promise<DispatchClaim> {
  await database()
    .prepare(
      "INSERT OR IGNORE INTO dispatch_locks (id,job_id) VALUES ('calle-account',?)",
    )
    .bind(previous.id)
    .run();
  const lock = await database()
    .prepare("SELECT job_id FROM dispatch_locks WHERE id='calle-account'")
    .first<{ job_id: string }>();
  if (lock?.job_id !== previous.id) return "busy";
  await database()
    .prepare(
      "INSERT OR IGNORE INTO usage_limits (id,used) SELECT ?,1 WHERE (SELECT COUNT(*) FROM usage_limits) < ?",
    )
    .bind(previous.id, limit)
    .run();
  const reservation = await database()
    .prepare("SELECT id FROM usage_limits WHERE id=?")
    .bind(previous.id)
    .first();
  if (!reservation) {
    await database()
      .prepare(
        "DELETE FROM dispatch_locks WHERE id='calle-account' AND job_id=?",
      )
      .bind(previous.id)
      .run();
    return "budget_exhausted";
  }
  // Evaluate grant time after reservation I/O. Expiry cannot be extended by latency.
  next.updatedAt = new Date().toISOString();
  const result = await database()
    .prepare(
      "UPDATE jobs SET status='dispatching',payload=?,updated_at=? WHERE id=? AND payload=? AND json_extract(payload, '$.grantExpiresAt') > ?",
    )
    .bind(
      JSON.stringify(next),
      next.updatedAt,
      previous.id,
      JSON.stringify(previous),
      next.updatedAt,
    )
    .run();
  return result.meta.changes ? "claimed" : "stale";
}

export async function getJobByCallId(callId: string): Promise<Job | null> {
  const row = await database()
    .prepare("SELECT payload FROM jobs WHERE call_id=? AND mode='live'")
    .bind(callId)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
export async function hasWebhookEvent(eventId: string): Promise<boolean> {
  return !!(await database()
    .prepare("SELECT id FROM events WHERE id=?")
    .bind(eventId)
    .first());
}
export async function recordWebhookEvent(
  eventId: string,
  jobId: string,
): Promise<void> {
  await database()
    .prepare(
      "INSERT OR IGNORE INTO events (id,job_id,created_at) VALUES (?,?,?)",
    )
    .bind(eventId, jobId, new Date().toISOString())
    .run();
}
export async function usageCount(): Promise<number> {
  const row = await database()
    .prepare("SELECT COUNT(*) AS total FROM usage_limits")
    .first<{ total: number }>();
  return row?.total ?? 0;
}
export async function auditFor(
  workspace: string,
  limit = 100,
): Promise<AuditEntry[]> {
  const rows = await database()
    .prepare(
      "SELECT action,detail,created_at,rental_id FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(workspace, Math.max(1, Math.min(500, Math.floor(limit))))
    .all<AuditEntry>();
  return rows.results;
}
