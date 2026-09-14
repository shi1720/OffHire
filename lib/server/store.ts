import { env } from "cloudflare:workers";
import type { Job, Rental } from "../offhire/types";
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
export function setting(name: string): string {
  return String(
    (env as unknown as Record<string, unknown>)[name] ??
      process.env[name] ??
      "",
  );
}
export function numberSetting(name: string, fallback: number) {
  const raw = setting(name);
  return raw && Number.isFinite(Number(raw))
    ? Math.max(0, Number(raw))
    : fallback;
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
