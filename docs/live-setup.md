# Connect CALL-E and record a real test

Demo mode works without credentials and never places calls. A synthetic rehearsal is not evidence that a real CALL-E phone call succeeded.

## 1. Create a server credential

Follow the [official installation guide](https://open.heycall-e.com/document/mcp-archive/CALL-E-installation-guide.md), then create a key in the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys). Keep the account email for Devpost. Check your available test calls and current usage terms in the dashboard.

Copy `.env.example` to the ignored `.env` for local development. Put the key in `CALLE_API_KEY`; never use a `NEXT_PUBLIC_` or `VITE_` prefix. Wrangler/Vinext load this file for local development. Restart the dev server after changing it.

For a local test, use `OFFHIRE_OWNER_EMAILS=seedy@sites.test`. This is the starter's loopback-only mock identity, not a real account. Leave the dev server bound to localhost. For Sites production, use the exact email of the signed-in operator instead. Store all production values in Sites runtime settings, never in the repository or hosting manifest.

Set `OFFHIRE_ENABLE_LIVE=true`, `OFFHIRE_ALLOWED_PHONES` to the exact E.164 number you own or have explicit permission to call, and `OFFHIRE_CALL_LIMIT=5` (or a lower integer). Comma-separated exact numbers are supported. The budget counts durable job reservations, including failed attempts; it is not a dollar spending cap and has no automatic reset. Raising it is an explicit operator action.

## 2. Verify without dialing

Open Connection → Live workspace, sign in, and choose Verify connection. This invokes the official SDK's `goals.list({limit: 1})`. Success proves authentication only. It does not prove phone connectivity, available credits, or a completed conversation.

## 3. Conduct the owned-number roleplay

Use [the supplier roleplay](rental-desk-roleplay.md). Add one fictional rental with the owned phone number, the correct supplier region/timezone, an existing fictional request, readiness and contact authorization. Check **Owned-number roleplay test**. The task will explicitly forbid changing any real rental.

Preview the plan, check its exact destination and task, then approve the call once. Keep the plan within its 15-minute grant. Ordinary supplier calls are additionally restricted to weekdays 08:00–18:00 in the entered supplier timezone; explicit owned-number roleplays bypass only that business-hours check.

Answer the phone and say the fictional asset/contract, cutoff date, numeric time, timezone, off-rent reference and collection window clearly. Confirm the agent's read-back. Use English for this version. The parser deliberately sends unsupported phrasing to review. Do not change the actual recorded outcome to make a demo look successful.

Record the screen and, with the participant's consent, a short part of the conversation. Preserve the real Call ID, transcript and resulting evidence export. Label it **owned-number roleplay**, not customer validation. Redact the phone number and personal account details before publication. The real call is the remaining technical proof until this test has actually run.

## Recovery and completion

An accepted Call ID is polled using `calls.get`. A transport failure during creation means acceptance is uncertain; do not start a replacement call. OffHire retains the exact body and key, locks the account, and offers recovery within the same grant. After the grant expires, reconcile externally in the CALL-E dashboard/support before an operator changes any lock or reservation. There is no CALL-E cancel endpoint in SDK 0.7.0; closing the page does not cancel a call.

Optional callbacks require a public reachable HTTPS URL. Generate a random secret token, store it as `OFFHIRE_WEBHOOK_TOKEN`, and set `OFFHIRE_WEBHOOK_URL` to `https://YOUR-SITE/api/webhooks/calle/TOKEN`. Do not publish the URL/token. An owner-private Sites gateway may block provider callbacks; leave callback settings empty until reachability is verified and use browser polling. Even with the token, callbacks are unsigned and their result is never trusted: the server retrieves the known Call ID through CALL-E before updating evidence.

For production number provisioning, shared-pool restrictions, KYC/SIP and current fees, use CALL-E's current account documentation. [Integration notes](call-e-integration.md) record the contract examined for this build.
