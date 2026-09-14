# Security and operating boundaries

The published code contains no API keys. Local `.env*` and `.dev.vars*`, generated output, database state and test artifacts are ignored by Git. The build wrapper removes local environment files that Cloudflare may emit for preview. Production credentials belong in Sites runtime secrets.

## Access and authorization

The Sites gateway authenticates operators and injects `oai-authenticated-user-id` / `oai-authenticated-user-email`. The API additionally requires the email to appear in `OFFHIRE_OWNER_EMAILS` before accessing the shared live workspace. A directly exposed standalone Worker must use an authenticating gateway that strips client-supplied identity headers; these headers are not themselves cryptographic credentials. The local mock sign-in is for localhost only.

Demo records use a 256-bit random HttpOnly, SameSite=Lax cookie (Secure on HTTPS). Every record lookup uses the current workspace. Live credentials, Call IDs and rental evidence are excluded from demo exports. Mutation routes reject cross-site requests, validate JSON and limit request size. Per-workspace record limits bound ordinary use; public abuse-rate limiting and automatic database cleanup are deployment work before a broader pilot.

Real destinations must match a server-side allowlist. Dispatch requires operator review, explicit rental readiness and contact authorization. The task is limited to an existing request for one asset. It discloses the AI assistant and forbids new purchases, fees, terms changes, unrelated assets and sensitive financial information. A phone conversation remains an external action; provider completion never substitutes for evidence checks.

## Provider events and failure behavior

CALL-E SDK 0.7.0 callbacks are unsigned. A secret path token and matching event header/body reduce accidental exposure but do not establish provider authorship. The handler ignores posted business outcomes and retrieves only a known live Call ID using the backend API key. Retryable retrieval failures are not marked processed.

Uncertain creation holds account capacity. Never manually clear its lock merely because a browser timed out. Reconcile accepted calls with CALL-E first. A lock plus idempotency bounds accidental duplicate requests; it cannot guarantee every carrier or provider behavior. The regression suite tests concrete races with a closed fake transport.

## Retention and production readiness

The seven-day demo cookie expiry does not delete D1 rows. Production retention/erasure, backups, monitoring, abuse controls, incident response, supplier consent processes and written operating procedures remain pilot requirements. Voice/audio retention is controlled by CALL-E; this app stores returned transcripts and evidence, not a separate call-audio recording.

User-entered collection and written-confirmation notes are attestations, not automatically verified supplier documents. The final invoice review is a date comparison only; it does not interpret contract terms or prove an overcharge. Use fictional details in the public demo.

No real supplier/customer pilot or CALL-E owned-number proof is claimed until separately recorded in the submission status.
