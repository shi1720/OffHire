# CALL-E integration research for OffHire

Verified September 14, 2026 from the installation guide, public developer documentation/OpenAPI, integration source, and the published TypeScript SDK 0.7.0 package. No calls, accounts, login flows, or external changes were made. Local checks inspected credential presence only.

## Recommendation

Use `@call-e/calle@0.7.0` in the trusted server, one call per off-hire verification job, backed by durable request/idempotency records. CALL-E should collect the supplier's actual off-rent confirmation and pickup arrangement; OffHire should separately classify billing stopped, equipment awaiting collection, and missing evidence. A connected/completed call is never sufficient to mark billing stopped. Provide a realistic fixture mode visibly labeled demo; preserve a distinct live mode that imports and invokes the SDK at runtime.

The Calls API is the best MVP fit: it supports request-scoped instructions and JSON extraction schemas, without first publishing a provider-owned Goal. OAuth MCP requires a separate plan/run flow and does not offer callbacks. Goal Runs can become a later reusable published workflow, but are unnecessary for this submission. [Calls](https://docs.heycall-e.com/calls), [SDKs](https://docs.heycall-e.com/sdks)

## Authentication and onboarding

1. Sign in or create the account through [CALL-E dashboard](https://dashboard.heycall-e.com).
2. Open [Account → API Keys](https://dashboard.heycall-e.com/account/api-keys), create a project API key, and put its complete value into backend `CALLE_API_KEY`. Keys currently use `iams_live_`; no token exchange is needed.
3. Backend base URL: `https://api.heycall-e.com`. Never expose the key as a `NEXT_PUBLIC_*` variable or in browser requests/logs.
4. Verify without a call using authenticated `GET /v1/goals?limit=1`. HTTP 200 is valid even if its data array is empty. HTTP 401 means bad/missing auth; 403 means insufficient capability/project/region access.
5. A live test requires an actual destination the user owns or is authorized to test. No guaranteed deterministic/free sandbox is documented. Test calls use the real account and may consume credits.

Presence check: `CALLE_API_KEY` absent in current process; no global `calle` binary; no `~/.calle-mcp/cli` cache directory/token; no project-root `.env*` file at research time. This does not establish absence from every possible user secret store. [Authentication](https://docs.heycall-e.com/authentication), [Quickstart](https://docs.heycall-e.com/quickstart)

The supplied [installation guide](https://open.heycall-e.com/document/mcp-archive/CALL-E-installation-guide.md) installs a portable skill with `npx -y skills add https://github.com/CALLE-AI/call-e-integrations --skill calle -g`, then `npm install -g @call-e/cli`, then browser-backed `calle auth login`. This is an alternative agent/MCP path, not a requirement for the server SDK. CLI authentication caches OAuth credentials under `~/.calle-mcp/cli/<server-hash>/token.json`; it is not the dashboard project API key.

## Actual server SDK request

```ts
import { CalleClient } from '@call-e/calle';

const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!,
  baseUrl: 'https://api.heycall-e.com',
  // SDK has no built-in per-request timeout option.
  fetch: request => fetch(request, { signal: AbortSignal.timeout(25_000) }),
});

const request = {
  task: job.frozenTask, // Include context, exact questions, and scope limits here.
  recipients: [{ phones: [job.phone], region: job.region, locale: job.locale }],
  resultSchema: offHireSchema,
  metadata: { application: 'offhire', job_id: job.id, rental_id: job.rentalId },
  ...(publicWebhookUrl ? { webhookUrl: publicWebhookUrl } : {}),
};
// Persist the ENTIRE request and this key atomically BEFORE dispatch.
const key = `offhire:${job.id}:verify:v1`;
const created = await client.calls.create(request, { idempotencyKey: key });
// Persist created.id immediately. The ID is call_..., not a provider call ID.
const latest = await client.calls.get(created.id);
const events = await client.calls.listEvents(created.id, { limit: 50 });
```

A custom fetch timeout stops local waiting, not the remote call. For application recovery, prefer `create` → persist ID → subsequent `get` over `createAndWait`: a polling timeout in the latter throws without returning the created ID. SDK `waitForResult` defaults to 2-second polls and a 600,000ms polling deadline. Both are local timing settings. [Published SDK source](https://github.com/CALLE-AI/server-sdk-typescript), [Calls recovery](https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response)

On the wire: `POST /v1/calls`, `Authorization: Bearer <key>`, `Content-Type: application/json`, `Idempotency-Key: <stable key>`. Body keys are `task`, `recipients`, `result_schema`, `recipient_result_schema`, `metadata`, `webhook_url`; the SDK converts camelCase input. `recipients` contains `{phones:string[], region?:string, locale?:string}`. Create returns HTTP 201 plus a CallTask object. Read routes are `GET /v1/calls/{id}` and `GET /v1/calls/{id}/events?cursor=...&limit=50` (limit maximum 100). No CallTask list endpoint exists. [OpenAPI 0.7.0](https://docs.heycall-e.com/openapi/calle.openapi.yaml)

## Response and status contract

HTTP CallTask fields:

```ts
{
  id: string, object: 'call_task',
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'canceled',
  task: string,
  structured_result: Record<string, unknown> | null,
  summary: string | null,
  task_completed: boolean | null,
  completion_confidence: { score: number, label: string } | null,
  evidence: string[], metadata: Record<string, unknown>,
  failure_code: string | null, failure_message: string | null,
  created_at: string, completed_at: string | null,
  recipients: [{
    id: string, phones: string[], locale: string | null, region: string | null,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped',
    structured_result: Record<string, unknown> | null,
    summary: string | null,
    attempts: [{
      id: string, phone: string,
      status: 'queued' | 'dialing' | 'in_progress' | 'completed' | 'failed' | 'canceled',
      started_at: string | null, completed_at: string | null,
      summary: string | null, provider_call_id: string | null,
      failure_code: string | null, failure_message: string | null,
      transcript_turns: [{ offset_seconds: number | null,
                          speaker: 'bot' | 'user' | 'unknown', text: string }]
    }]
  }]
}
```

The SDK converts resource keys to `structuredResult`, `taskCompleted`, `completionConfidence`, `failureCode`, `createdAt`, `transcriptTurns`, etc. **Transcript turn `offset_seconds` remains snake_case** in the SDK. `listEvents` returns `{object:'list', data:[...], nextCursor}`; event items retain `call_id`, `created_at` and other wire keys. Transcripts may be empty; no public audio URL is present in CallTask (audio is available through dashboard call records). `providerCallId` correlates to dashboard records, not API calls.

Top-level API terminal statuses are exactly `completed`, `failed`, `canceled`. Do not import MCP outcomes such as `NO_ANSWER`, `BUSY`, or `VOICEMAIL` into this lifecycle. `in_progress` includes post-call extraction. `taskCompleted` says the question reached a clear end state, and its confidence measures that judgment; neither means the desired commercial outcome happened. Arbitrary `failure_code` strings are diagnostic, not a published enum. [Calls](https://docs.heycall-e.com/calls), [Errors](https://docs.heycall-e.com/errors)

## Schemas and OffHire extraction

Supported result schema features: object/string/number/integer/boolean/array, properties, required, enum, nested objects, simple array items, descriptions, and `additionalProperties:false`. Avoid `$ref`, unions/`anyOf`/`oneOf`/`allOf`, recursive schemas, format constraints, and `additionalProperties:true`. Use explicit unknown enums and empty strings rather than relying on nullable union schemas. Strict schema validation can yield `structuredResult:null`; treat that as unresolved.

Recommended compact OffHire fields: `billing_stopped: yes/no/unknown`, `effective_off_rent_at: string`, `off_rent_reference: string`, `pickup_status: collected/scheduled/pending/unknown`, `pickup_window: string`, `supplier_contact: string`, `evidence_quote: string`, `needs_human_review: yes/no/unknown`. Explain that readiness for pickup and scheduled collection do not themselves establish an off-rent date or stopped charges. Use explicit transcript evidence plus the app's deterministic gates before displaying confirmation. Preserve uncertainty.

For multi-recipient tasks use `recipientResultSchema`; avoid reserved fields (`summary`, `status`, `transcript`, `call_id`, timing fields) in that custom schema. For the MVP, one recipient per durable verification job keeps retries and evidence clear. [Structured results](https://docs.heycall-e.com/calls#structured-results)

## Durable recovery and webhook handling

- Freeze the request and stable key before POST. Retry an uncertain create with the identical body and same key; this returns the original call. New timestamps, metadata, schemas, or callback URL produce `idempotency_conflict` when the key is reused.
- Once a Call ID is saved, only retrieve it to learn its outcome. A browser disconnect, local timeout, process restart, or polling outage does not mean the provider failed or canceled the call.
- Create responses can be lost and native transport/JSON errors are not all guaranteed to be SDK typed errors. Track an explicit `dispatch_uncertain` state instead of generating another key.
- Retry read errors with backoff. Reject invalid inputs rather than blindly retrying. Surface balance/auth/region errors clearly. Keep provider codes as diagnostic text, not business truth.
- Calls cannot be canceled through this API. A UI Stop/Pause control may stop future jobs or polling, but must not claim it stopped an accepted call. Scheduling and repeat logic must be handled in our service.

Webhook URL must be public HTTPS. Envelope is `{id, type, created_at, data:<terminal CallTask>}`; supported types are `call.completed`, `call.failed`, `call.result_validation_failed`. Failed and canceled tasks both use `call.failed`. The event snapshot includes finalized extraction and transcripts.

**Current callbacks are unsigned.** Validate JSON shape, size, and `CALL-E-Event-Id === body.id`. This equality is not authentication. Look up `data.id` in our own jobs and fetch the corresponding CallTask using our API key; derive business state from that authenticated result. Do not trust caller-supplied metadata to select a tenant. Dedupe by event ID and apply state transactionally; failed processing must remain retryable. Return 2xx after acceptance. Delivery is at least once; non-2xx/network failures retry. Avoid deprecated SDK `webhooks.unwrap`/`verify` helpers: they expect legacy signatures not sent now. [Webhooks](https://docs.heycall-e.com/webhooks)

For serverless deployment, use short create/read routes and a persisted next-check time, plus signed platform cron or a worker for reconciliation. Do not rely on an unawaited promise after an HTTP response. A refresh-driven polling fallback is useful but should not be described as unattended completion unless a worker/cron or callback is active.

## Pricing and deployment constraints: material discrepancy

The current [marketing FAQ](https://www.heycall-e.com/) still says 20 free calls and $0.05 per billable call, explicitly early-stage. **The public docs repository has a newer September 14 change** describing 10-second billing increments with a Call fee plus a Success fee, including preparation/pre-connection cost even if not connected. It publishes no numeric rates. The deployed docs page retrieved during research still stopped at September 10. Therefore do not advertise guaranteed $0.05 live cost or fabricated margins: label costs configurable assumptions, cite this discrepancy, and confirm in dashboard/provider billing before paid use. [September 14 source changelog](https://github.com/CALLE-AI/calle-docs/blob/main/content/guides/changelog.mdx)

That September 14 source also states concurrent limits: shared pool 1, purchased numbers 10, SIP no CALL-E-imposed cap (not CPS limits). Default the MVP to one active live call. September 7 deployed documentation states shared pool is testing-only; production uses purchased numbers with completed KYC or SIP. India supports English/Hindi/Tamil via international lines intended for testing; production local line requires CALL-E arrangement. US/SG/MY/AE/AU/MX/BR have listed local-line availability. [Regions](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages), [Changelog](https://docs.heycall-e.com/changelog)

## Useful provider feedback for submission

1. Public pricing FAQ and September 14 source changelog conflict; add a published, versioned rate sheet and cost estimate/billed cost to API resources.
2. Add cryptographically signed webhooks and retry schedule/retention documentation.
3. Add cancel and list/recovery-by-idempotency endpoints; durable calls are difficult to reconcile after lost local state.
4. Publish request rate limits and terminal failure/disposition contracts. Avoid conflating post-call task completion with favorable business outcome.
5. Surface dashboard/provider call IDs and transcript structures clearly across camelCase and snake_case SDK fields.

Research provenance: `call-e-integrations` commit `1ce9d77b09b6178ff5614297634bb40b40dd6dea`; `calle-docs` commit `88f37fff8194bc4754deea595149890e0be091a3`; npm `@call-e/calle` 0.7.0 tarball SHA-1 `23da7e35eb6306e64a2d7b8ddf0ed265c77f53b5`. Downloaded sources are under `work/call-e-research/` for implementation reference.
