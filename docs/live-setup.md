# Connect CALL-E and record a real test

Demo mode works without credentials and never places calls. A synthetic rehearsal is not evidence that a real CALL-E phone call succeeded.

## Firebase: enable live calling with one command

In your existing Cloud Shell checkout, run:

```bash
git pull --ff-only && npm run deploy:firebase -- --enable-live
```

Keep the saved Firebase project, Hosting site and operator email. The script asks for:

1. Your own phone number, or a number you have explicit permission to call, in **E.164 format**: `+` followed by country code and number, without spaces. Multiple authorized numbers can be comma-separated.
2. A total call-attempt budget; press Enter for **5** on first setup. Existing reservations are preserved, including unsuccessful attempts. This is not a daily limit and does not reset on deployment.
3. Your **CALL-E SDK API key**, pasted at a hidden prompt. Create/copy one in the [CALL-E API-key dashboard](https://dashboard.heycall-e.com/account/api-keys). The earlier CLI browser login is a different credential; do not paste that token or a Firebase web API key. Check available calling credits in CALL-E too.

The command checks the new SDK key without dialing, stores it in Secret Manager through standard input, grants the runtime service account access, pins the secret version, enables live dispatch for your authorized numbers, builds Cloud Run and republishes Firebase Hosting. It then verifies the app, Firebase project, Firestore demo and published live/key configuration. The key is never saved in the checkout or supplied as a command argument. [CALL-E authentication](https://docs.heycall-e.com/authentication), [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

Wait for **“Live calling is enabled”** and the final Hosting URL. No other Firebase Console environment-setting steps are required. If the terminal stops at a permissions error, the active gcloud account needs the reported access to the selected project; rerun after resolving it. When an existing standard secret binding is reused, the script does not read its value: use **Verify connection** in the app to check that credential still works.

For a later key replacement, run `npm run deploy:firebase -- --enable-live --replace-key`. To change authorized numbers or budget, rerun `--enable-live` and edit their prompts; the existing key is reused. Ordinary `npm run deploy:firebase` updates preserve live settings. A fresh live setup needs the interactive hidden prompt, so omit `--yes`. Keep API keys out of chat and shell history.

### Test the deployed app

1. Open your Hosting URL (for Shivam's project, **https://offhire.web.app**), then **Connection → Live workspace**. Sign in with the exact Google email selected during deployment.
2. Confirm **Server API key: Configured** and **Live dispatch: Enabled for approved operators**. Click **Verify connection**. This checks CALL-E authentication without placing a call; it does not prove telephony or credits.
3. Add a fictional closeout: asset **TH-118**, equipment **telehandler**, supplier **Northstar Rentals**, contract **NS-62018**, site **Riverside · Loading bay**. Enter the same authorized phone number you entered in the terminal. Select the destination's supported region and appropriate timezone; for your own Indian number use **IN / Asia/Kolkata**. Put “Fictional roleplay: return requested; pickup and billing cutoff need confirmation” in the existing request field. Fill the other required fields, tick readiness, permission, and **Owned-number roleplay test**.
4. Open the rental, review its call plan, check its exact number and task, tick approval and press **Place approved call** once. Plans expire after 15 minutes; create a fresh plan if needed. This action makes the real outbound call and consumes a call attempt.
5. Answer your phone. Say: “Northstar Rentals, Alex speaking. Yes, I'm ready for this fictional test. No real rental changes. For asset T H one one eight, contract N S six two zero one eight, pickup is tomorrow between nine and eleven in the morning, in the timezone on this record. I cannot confirm the billing cutoff or give an off-rent reference yet.” Confirm that distinction when the agent reads it back. Use English for this version.
6. Keep the app open for polling. Check the saved **Call ID**, transcript and outcome. This scenario should leave billing **unconfirmed / needs clarification**, even if CALL-E reports the conversation completed. A pickup promise must not become confirmed billing or completed collection. Export the evidence if needed. The detailed [roleplay script](rental-desk-roleplay.md) includes a second scenario.

If no call arrives, inspect the saved job/provider status and CALL-E dashboard for credit, destination, region or account restrictions. Do not repeatedly press dispatch for an uncertain submission: use the existing job's recovery/refresh action. See recovery below. A real call remains unverified until you perform this test.

## 1. Create a server credential

The following environment-file instructions are for local development or the original Sites deployment. Firebase users can skip them after the command above.

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
