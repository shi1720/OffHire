import { env } from "cloudflare:workers";
import * as d1 from "./d1-store";
import type { Job, Rental } from "../offhire/types";
import type { Persistence } from "./persistence";

/** D1 remains the default; Firebase loads only its durable Firestore adapter. */
async function repository(): Promise<Persistence> {
  return setting("OFFHIRE_RUNTIME") === "firebase"
    ? (await import("./firestore-store")).firestoreStore()
    : d1;
}
export function setting(name: string): string {
  return String(
    (env as unknown as Record<string, unknown>)[name] ??
      process.env[name] ??
      "",
  );
}
export function numberSetting(name: string, fallback: number): number {
  const raw = setting(name);
  return raw && Number.isFinite(Number(raw))
    ? Math.max(0, Number(raw))
    : fallback;
}
export const rentalsFor = async (workspace: string) =>
  (await repository()).rentalsFor(workspace);
export const jobsFor = async (workspace: string) =>
  (await repository()).jobsFor(workspace);
export const getRental = async (id: string, workspace: string) =>
  (await repository()).getRental(id, workspace);
export const getJob = async (id: string, workspace?: string) =>
  (await repository()).getJob(id, workspace);
export const saveRental = async (rental: Rental) =>
  (await repository()).saveRental(rental);
export const saveJob = async (job: Job) => (await repository()).saveJob(job);
export const recordAudit = async (
  workspace: string,
  rental: string | null,
  action: string,
  detail: string,
) => (await repository()).recordAudit(workspace, rental, action, detail);
export const compareAndSaveJob = async (previous: Job, next: Job) =>
  (await repository()).compareAndSaveJob(previous, next);
export const releaseTerminalLock = async (id: string) =>
  (await repository()).releaseTerminalLock(id);
export const ensureWorkspace = async (
  id: string,
  mode: "demo" | "live",
  rentals: Rental[],
  jobs: Job[],
) => (await repository()).ensureWorkspace(id, mode, rentals, jobs);
export const resetWorkspace = async (
  id: string,
  rentals: Rental[],
  jobs: Job[],
) => (await repository()).resetWorkspace(id, rentals, jobs);
export const claimDispatch = async (previous: Job, next: Job, limit: number) =>
  (await repository()).claimDispatch(previous, next, limit);
export const getJobByCallId = async (callId: string) =>
  (await repository()).getJobByCallId(callId);
export const hasWebhookEvent = async (eventId: string) =>
  (await repository()).hasWebhookEvent(eventId);
export const recordWebhookEvent = async (eventId: string, jobId: string) =>
  (await repository()).recordWebhookEvent(eventId, jobId);
export const usageCount = async () => (await repository()).usageCount();
export const auditFor = async (workspace: string, limit = 100) =>
  (await repository()).auditFor(workspace, limit);

// D1-only compatibility for schema tooling and the existing SQL regression harness.
export const database = d1.database;
export const rentalStatement = d1.rentalStatement;
export const jobStatement = d1.jobStatement;
