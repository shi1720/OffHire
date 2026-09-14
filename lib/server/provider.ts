import { CalleClient, type CreateCallInput, type Call } from "@call-e/calle";
import type { CallSnapshot } from "../offhire/types";
import { setting } from "./store";
export function calle() {
  const key = setting("CALLE_API_KEY");
  if (!key)
    throw new Error(
      "Add a CALL-E API key to the server connection before placing a live call.",
    );
  return new CalleClient({
    apiKey: key,
    baseUrl: "https://api.heycall-e.com",
    fetch: (input) => fetch(input, { signal: AbortSignal.timeout(25000) }),
  });
}
export function snapshot(call: Call): CallSnapshot {
  return {
    id: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted ?? null,
    structuredResult: call.structuredResult ?? null,
    summary: call.summary ?? null,
    completedAt: call.completedAt ?? null,
    failureCode: call.failureCode ?? null,
    recipients: (call.recipients ?? []).map((r) => ({
      status: r.status,
      structuredResult: r.structuredResult,
      attempts: (r.attempts ?? []).map((a) => ({
        status: a.status,
        transcriptTurns: (a.transcriptTurns ?? []).map((t) => ({
          speaker: t.speaker,
          text: t.text,
          offset_seconds: t.offset_seconds ?? null,
        })),
      })),
    })),
  };
}
export async function createCall(requestJson: string, idempotencyKey: string) {
  const request = JSON.parse(requestJson) as CreateCallInput;
  return snapshot(await calle().calls.create(request, { idempotencyKey }));
}
export async function readCall(id: string) {
  return snapshot(await calle().calls.get(id));
}
export async function verifyConnection() {
  await calle().goals.list({ limit: 1 });
  return true;
}
