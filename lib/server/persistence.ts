import type { Job, Rental } from "../offhire/types";

export type DispatchClaim = "claimed" | "busy" | "budget_exhausted" | "stale";
export type AuditEntry = {
  action: string;
  detail: string;
  created_at: string;
  rental_id: string | null;
};
export interface Persistence {
  rentalsFor(workspace: string): Promise<Rental[]>;
  jobsFor(workspace: string): Promise<Job[]>;
  getRental(id: string, workspace: string): Promise<Rental | null>;
  getJob(id: string, workspace?: string): Promise<Job | null>;
  saveRental(rental: Rental): Promise<void>;
  saveJob(job: Job): Promise<void>;
  recordAudit(
    workspaceId: string,
    rentalId: string | null,
    action: string,
    detail: string,
  ): Promise<void>;
  compareAndSaveJob(previous: Job, next: Job): Promise<boolean>;
  releaseTerminalLock(jobId: string): Promise<void>;
  ensureWorkspace(
    id: string,
    mode: "demo" | "live",
    rentals: Rental[],
    jobs: Job[],
  ): Promise<void>;
  resetWorkspace(id: string, rentals: Rental[], jobs: Job[]): Promise<void>;
  claimDispatch(
    previous: Job,
    next: Job,
    limit: number,
  ): Promise<DispatchClaim>;
  getJobByCallId(callId: string): Promise<Job | null>;
  hasWebhookEvent(eventId: string): Promise<boolean>;
  recordWebhookEvent(eventId: string, jobId: string): Promise<void>;
  usageCount(): Promise<number>;
  auditFor(workspace: string, limit?: number): Promise<AuditEntry[]>;
}
