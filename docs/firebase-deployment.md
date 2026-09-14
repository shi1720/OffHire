# OffHire on Firebase — exact deployment commands

Verified against official documentation on 14 September 2026. The Firebase adaptation is implemented in the repository. These are commands for Shivam to run; no Firebase or Google Cloud resources have been created or deployed by this task.

## One-command deployment for your existing Firebase project

You can skip the manual steps below if your Firebase project already exists, billing is linked and Google sign-in is enabled. In your updated checkout, run:

```bash
git pull
npm run deploy:firebase
```

Enter your existing **Firebase project ID**, the **Hosting site ID** (press Enter for `offhire`) and the **Google email allowed to operate the app**. The script discovers the Firebase web app/configuration; it creates a web app if none exists and asks you to choose if several cannot be distinguished. You do not need to copy the Firebase API key.

The command uses `scripts/deploy-firebase.mjs` and performs the remaining setup: service APIs, runtime/build identities and IAM roles, Firestore database if absent, Auth authorized domain, container build, Cloud Run deployment, Firestore rules/indexes, and Firebase Hosting publication. It reuses existing resources. It checks the served page, Firebase project configuration and demo database access before printing success. This verifies deployment, not production Google login or a phone conversation; sign in yourself after deployment.

Run in [Google Cloud Shell](https://shell.cloud.google.com/) or a Mac/Linux terminal with **Node 22.13+ and gcloud**. The script retrieves Firebase CLI 15.30.0 through `npx` and initiates CLI login if needed. No `npm ci` or local Docker is required. If billing is missing or Google sign-in is disabled, it stops with the exact prerequisite to fix. It does not choose a billing account.

For explicit settings:

```bash
npm run deploy:firebase -- --project YOUR_FIREBASE_PROJECT_ID --site offhire --owner YOUR_GOOGLE_EMAIL
```

For a fresh Cloud Shell checkout:

```bash
git clone https://github.com/shi1720/call-e.git offhire-firebase
cd offhire-firebase
npm run deploy:firebase
```

Future updates use `git pull` and `npm run deploy:firebase` again. Selection settings are saved in `.deploy/firebase-deploy.json`, excluded from Git and the cloud build. Existing CALL-E secrets, destination allowlists, budgets and live flags are preserved through partial environment updates. The first deployment defaults to live calls disabled and a five-call limit. The script never asks for a CALL-E key or places calls; use optional step 8 later.

`--app WEB_APP_ID` selects a particular Firebase web app. `--yes` suppresses script prompts using supplied/saved values; authenticate both CLIs first and supply `--owner` on a fresh unattended deployment. Run `npm run deploy:firebase -- --help` for options. If a build or permission check fails, fix the reported error and rerun; no new project is created and existing resources are reused. Organization IAM restrictions can still require an administrator.

The script deploys this repository's Firestore rules and indexes to the selected project and publishes the selected Hosting site. Use the Firebase project dedicated to OffHire. `offhire.web.app` is only available when your project owns the `offhire` Hosting site; the script stops if another project owns it.

Fourteen fixture-based deployment tests cover provisioning, reruns, credential preservation, failures and verification. These tests do not provision real Google Cloud resources. The script follows the official [Auth configuration API](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig), [Google provider configuration API](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs/get), and [gcloud structured flag-file format](https://docs.cloud.google.com/sdk/gcloud/reference/topic/flags-file).

The numbered steps below remain available as a manual reference; the script replaces steps 4–7 and checks/reuses the prerequisites from steps 1–3.

## Recommended deployment

Use Firebase Hosting for `https://offhire.web.app`, forwarding the application to the `offhire` Cloud Run service in `us-central1`. Cloud Run builds the repository's Dockerfile, runs the Next.js standalone server, and accesses the default Firestore database with its own service account. Firebase Authentication handles Google sign-in; OffHire checks verified Google email addresses against `OFFHIRE_OWNER_EMAILS` on the server.

The Hosting site ID determines the `web.app` address. **`offhire` is a valid seven-character site ID, but it must be globally available or already owned by your project.** A different Google Cloud/Firebase project ID can still own this site. Renaming a project's display name cannot reserve the address. A missing webpage or DNS response does not prove the site ID is available. The create/get commands below establish ownership. [Hosting multisites](https://firebase.google.com/docs/hosting/multisites), [project identifiers](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects)

Cloud Run requires a linked Cloud Billing account. Linking one upgrades a Firebase Spark project to Blaze. Free usage allowances can reduce charges; they do not guarantee a zero bill. Build, registry, database, secrets and network usage also matter. A billing budget sends alerts and is not a spending cap. [Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run), [budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets)

## 1. Open a Bash terminal and sign in

The commands use Bash. Google Cloud Shell already provides `gcloud`; for a local terminal first install the [Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/install). Use a current Node.js version supported by the repository and Firebase CLI. The same Google account should own the Firebase project and have access to the billing account.

```bash
npm install --global firebase-tools
firebase login
gcloud auth login
firebase --version
gcloud version

git clone https://github.com/shi1720/call-e.git offhire-firebase
cd offhire-firebase
```

If this checkout already exists, enter it and update it rather than cloning over it. The final checkout must include `Dockerfile`, `firebase.json`, `firestore.rules`, and Next.js `output: "standalone"`. Do not run an interactive `firebase init hosting` over the supplied Hosting rewrite configuration. [Firebase CLI](https://firebase.google.com/docs/cli)

## 2. Create the project and reserve the clean address

This creates a separate project ID with a random suffix. The exact site requested remains `offhire`.

```bash
export OFFHIRE_PROJECT="offhire-prod-$(openssl rand -hex 3)"
export OFFHIRE_SITE="offhire"
export OFFHIRE_REGION="us-central1"

firebase projects:create "$OFFHIRE_PROJECT" --display-name "OffHire"
gcloud config set project "$OFFHIRE_PROJECT"
firebase use "$OFFHIRE_PROJECT" --alias production
firebase hosting:sites:create "$OFFHIRE_SITE" --project "$OFFHIRE_PROJECT"
firebase hosting:sites:get "$OFFHIRE_SITE" --project "$OFFHIRE_PROJECT"
firebase target:apply hosting offhire "$OFFHIRE_SITE" --project "$OFFHIRE_PROJECT"
```

Stop at any error. If `offhire` is unavailable, these commands cannot produce `offhire.web.app`. If you already own that site in another project, select that actual project instead. Otherwise a different available site ID is necessary. Do not delete an existing Hosting site to try to recycle its name; Firebase says deleted site IDs cannot be reactivated.

The `offhire` before `"$OFFHIRE_SITE"` in `target:apply` is a local deploy target, matching `firebase.json`; it is not another reserved domain. `firebase use` creates the `production` alias for the project. Source-verified command signatures: [projects:create](https://github.com/firebase/firebase-tools/blob/master/src/commands/projects-create.ts), [use](https://github.com/firebase/firebase-tools/blob/master/src/commands/use.ts), [Hosting IDs and targets](https://firebase.google.com/docs/hosting/multisites), [deploy targets](https://firebase.google.com/docs/cli/targets).

## 3. Link billing, enable services and create Firestore

Select your actual active billing account. Running `billing projects link` enables billed usage for the project; this is the explicit billing step.

```bash
gcloud billing accounts list
read -r -p "Billing account ID to use: " OFFHIRE_BILLING_ACCOUNT
gcloud billing projects link "$OFFHIRE_PROJECT" \
  --billing-account "$OFFHIRE_BILLING_ACCOUNT"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  firebasehosting.googleapis.com \
  storage.googleapis.com \
  --project "$OFFHIRE_PROJECT"

gcloud firestore databases create \
  --database='(default)' \
  --location="$OFFHIRE_REGION" \
  --type=firestore-native \
  --edition=standard \
  --project="$OFFHIRE_PROJECT"

gcloud firestore databases describe \
  --database='(default)' \
  --project="$OFFHIRE_PROJECT"
```

For an existing project, inspect the database before attempting creation; reuse a compatible existing `(default)` database. Database location is a durable architectural choice. The supplied server implementation uses Native mode, not Datastore mode. Publish the supplied deny-all client rules later; server Admin SDK access uses IAM. [Billing link command](https://docs.cloud.google.com/sdk/gcloud/reference/billing/projects/link), [database creation command](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/create), [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam)

## 4. Create separate runtime and build identities

The runtime needs Firestore data access and only the two Auth operations used by this implementation. The build identity receives build permissions separately, without access to CALL-E secrets.

```bash
gcloud iam service-accounts create offhire-runtime \
  --display-name="OffHire runtime" \
  --project="$OFFHIRE_PROJECT"

gcloud iam service-accounts create offhire-build \
  --display-name="OffHire container build" \
  --project="$OFFHIRE_PROJECT"

export OFFHIRE_RUNTIME_SA="offhire-runtime@${OFFHIRE_PROJECT}.iam.gserviceaccount.com"
export OFFHIRE_BUILD_SA="offhire-build@${OFFHIRE_PROJECT}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$OFFHIRE_PROJECT" \
  --member="serviceAccount:$OFFHIRE_RUNTIME_SA" \
  --role="roles/datastore.user" \
  --condition=None

gcloud iam roles create offhireSessionAuth \
  --project="$OFFHIRE_PROJECT" \
  --title="OffHire session authentication" \
  --description="Create Firebase session cookies and check user revocation state" \
  --permissions="firebaseauth.users.createSession,firebaseauth.users.get" \
  --stage=GA

gcloud projects add-iam-policy-binding "$OFFHIRE_PROJECT" \
  --member="serviceAccount:$OFFHIRE_RUNTIME_SA" \
  --role="projects/$OFFHIRE_PROJECT/roles/offhireSessionAuth" \
  --condition=None

gcloud projects add-iam-policy-binding "$OFFHIRE_PROJECT" \
  --member="serviceAccount:$OFFHIRE_BUILD_SA" \
  --role="roles/run.builder" \
  --condition=None
```

`firebaseauth.users.createSession` authorizes `createSessionCookie`. The `true` revocation check in `verifySessionCookie(cookie, true)` reads the user's record, requiring `firebaseauth.users.get`. Neither full Firebase Auth Admin nor a downloaded service-account private key is needed for these operations. The Cloud Run service uses Application Default Credentials from its attached identity. [Auth method permissions](https://docs.cloud.google.com/identity-platform/docs/access-control), [Admin SDK revocation implementation](https://github.com/firebase/firebase-admin-node/blob/master/src/auth/base-auth.ts), [custom-role command](https://docs.cloud.google.com/sdk/gcloud/reference/iam/roles/create)

The commands assume the project creator has permissions to deploy and grant IAM roles. In an organization-managed project, an administrator must grant the deployer `roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer`, and permission to act as the runtime and build identities; making the HTTP service public also needs permission to change its invocation policy. Do not solve missing deployment permission by making the runtime an Editor or Owner. [Source deployment permissions](https://docs.cloud.google.com/run/docs/deploying-source-code), [custom build identity](https://docs.cloud.google.com/run/docs/configuring/services/build-service-account)

## 5. Register the web app and enable Google sign-in

```bash
firebase apps:create WEB "OffHire" --project "$OFFHIRE_PROJECT"
read -r -p "Paste the Firebase App ID printed above: " OFFHIRE_FIREBASE_APP_ID
firebase apps:sdkconfig WEB "$OFFHIRE_FIREBASE_APP_ID" --project "$OFFHIRE_PROJECT"
read -r -p "Paste the public apiKey from that web SDK config: " OFFHIRE_FIREBASE_WEB_API_KEY
read -r -p "Google email allowed to operate OffHire: " OFFHIRE_OWNER_EMAIL
export OFFHIRE_FIREBASE_WEB_API_KEY OFFHIRE_OWNER_EMAIL
```

The web SDK `apiKey` is public client configuration. It is different from the private CALL-E API key. The application serves its Firebase client configuration at runtime, so no web-config build arguments are needed. [apps:create implementation](https://github.com/firebase/firebase-tools/blob/master/src/commands/apps-create.ts), [apps:sdkconfig implementation](https://github.com/firebase/firebase-tools/blob/master/src/commands/apps-sdkconfig.ts)

In the Firebase console for this project:

1. Open **Authentication → Sign-in method**, enable **Google**, choose a support email when prompted, and save.
2. In **Authentication → Settings → Authorized domains**, add **`offhire.web.app`**. Keep the project's default Firebase auth domain. If a different site ID was necessary, authorize that actual `SITE_ID.web.app` instead.
3. Use the Google account whose verified email you entered above. Enabling Google sign-in is not an email allowlist by itself; OffHire enforces its server allowlist separately.

Keep the default SDK auth domain for this flow unless the implementation explicitly changes it. Changing `authDomain` to a custom domain also requires the corresponding OAuth redirect URI configuration; merely adding an authorized domain is not the same operation. [Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin)

## 6. Deploy the Next.js container in rehearsal mode

Write a local, non-secret runtime settings file. Keep `.deploy/` out of git. For multiple owner emails, enter a comma-separated string in `OFFHIRE_OWNER_EMAIL`; the YAML file avoids shell flag comma parsing.

```bash
mkdir -p .deploy
python3 - <<'PY'
import json
import os
from pathlib import Path

config = {
    "OFFHIRE_RUNTIME": "firebase",
    "GOOGLE_CLOUD_PROJECT": os.environ["OFFHIRE_PROJECT"],
    "OFFHIRE_PUBLIC_ORIGIN": "https://" + os.environ["OFFHIRE_SITE"] + ".web.app",
    "FIREBASE_WEB_API_KEY": os.environ["OFFHIRE_FIREBASE_WEB_API_KEY"],
    "OFFHIRE_OWNER_EMAILS": os.environ["OFFHIRE_OWNER_EMAIL"],
    "OFFHIRE_ENABLE_LIVE": "false",
    "OFFHIRE_CALL_LIMIT": "5",
}
Path(".deploy/runtime-env.yaml").write_text(
    "".join(key + ": " + json.dumps(value) + "\n" for key, value in config.items())
)
PY

gcloud run deploy offhire \
  --source=. \
  --project="$OFFHIRE_PROJECT" \
  --region="$OFFHIRE_REGION" \
  --service-account="$OFFHIRE_RUNTIME_SA" \
  --build-service-account="projects/$OFFHIRE_PROJECT/serviceAccounts/$OFFHIRE_BUILD_SA" \
  --allow-unauthenticated \
  --port=8080 \
  --cpu=1 \
  --memory=512Mi \
  --min=0 \
  --max=3 \
  --concurrency=20 \
  --timeout=60s \
  --env-vars-file=.deploy/runtime-env.yaml
```

`--source=.` uses the supplied Dockerfile when it exists, builds the container with Cloud Build, and stores it in Artifact Registry. It does not require local Docker. The Dockerfile must copy `public/` and `.next/static/` into the standalone output and start the server on `0.0.0.0:$PORT`. [Cloud Run source builds](https://docs.cloud.google.com/run/docs/deploying-source-code), [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [deploy flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy)

`--allow-unauthenticated` exposes the HTTP entry point so Firebase Hosting and public rehearsal visitors can reach it. Protected server actions still require the verified, allowlisted OffHire session. The direct `run.app` URL is also reachable, so security must live in the app rather than depend on users knowing only the Hosting URL. A maximum instance setting is not a hard spending cap.

## 7. Publish the clean Firebase URL

The checked-in `firebase.json` must have target `offhire` and a catch-all rewrite to Cloud Run service `offhire`, region `us-central1`. A `public` directory used solely for Hosting must not contain an `index.html` that shadows this rewrite. If the config uses `pinTag: true`, repeat the Hosting deploy after every Cloud Run revision change, including secret or environment updates.

Expected relevant configuration (review only; use the repository's supplied file):

```json
{
  "hosting": {
    "target": "offhire",
    "public": "firebase-public",
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "offhire",
          "region": "us-central1",
          "pinTag": true
        }
      }
    ]
  }
}
```

The actual file also needs its supplied Firestore rules configuration. Deploy from the repository root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,hosting:offhire --project "$OFFHIRE_PROJECT"
firebase hosting:sites:get "$OFFHIRE_SITE" --project "$OFFHIRE_PROJECT"
curl -I "https://${OFFHIRE_SITE}.web.app/"
```

Open **`https://offhire.web.app`** after a successful deployment. Confirm the actual app renders, Google sign-in works for the allowed account, and a different account cannot use protected live actions. A URL is not considered deployed merely because it appears in this guide. [Cloud Run rewrites and pinning](https://firebase.google.com/docs/hosting/cloud-run), [targeted deploy command](https://firebase.google.com/docs/cli/targets)

## 8. Add the CALL-E secret when ready to enable live calls

The public rehearsal deploy above does not need the private CALL-E API key. When ready, enter it at the silent prompt; do not paste it into source, a Docker build argument, a web config or a command-line literal.

```bash
gcloud secrets create CALLE_API_KEY \
  --replication-policy=automatic \
  --project="$OFFHIRE_PROJECT"

read -r -s -p "CALL-E API key: " OFFHIRE_CALLE_KEY
printf '\n'
printf '%s' "$OFFHIRE_CALLE_KEY" | \
  gcloud secrets versions add CALLE_API_KEY \
    --data-file=- \
    --project="$OFFHIRE_PROJECT"
unset OFFHIRE_CALLE_KEY

gcloud secrets add-iam-policy-binding CALLE_API_KEY \
  --project="$OFFHIRE_PROJECT" \
  --member="serviceAccount:$OFFHIRE_RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None

gcloud secrets versions list CALLE_API_KEY \
  --project="$OFFHIRE_PROJECT" \
  --format='table(name,state)'
read -r -p "Enabled numeric secret version to deploy: " OFFHIRE_CALLE_VERSION

gcloud run services update offhire \
  --project="$OFFHIRE_PROJECT" \
  --region="$OFFHIRE_REGION" \
  --update-secrets="CALLE_API_KEY=CALLE_API_KEY:$OFFHIRE_CALLE_VERSION"

firebase deploy --only hosting:offhire --project "$OFFHIRE_PROJECT"
```

If the secret already exists, skip `secrets create` and add a version. Pin the numeric enabled version to make the deployed credential choice explicit. Access is granted on this one secret, not on all secrets in the project. Any optional webhook credential needs its own secret and its own access binding. [Secret creation](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/create), [version upload](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/versions/add), [per-secret IAM](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/add-iam-policy-binding), [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

After rehearsal and account checks pass, allow the explicit owned/authorized test destination and enable live mode:

```bash
read -r -p "Authorized test phone in E.164 format, including +: " OFFHIRE_TEST_PHONE
gcloud run services update offhire \
  --project="$OFFHIRE_PROJECT" \
  --region="$OFFHIRE_REGION" \
  --update-env-vars="^|^OFFHIRE_ENABLE_LIVE=true|OFFHIRE_ALLOWED_PHONES=$OFFHIRE_TEST_PHONE|OFFHIRE_CALL_LIMIT=5"
firebase deploy --only hosting:offhire --project "$OFFHIRE_PROJECT"
```

This enables the existing approval flow; it does not place a phone call. Sign in, review the actual call plan, and approve the authorized test in the app. Preserve the returned provider record as live evidence only after the actual interaction is verified. To disable new live dispatches later:

```bash
gcloud run services update offhire \
  --project="$OFFHIRE_PROJECT" \
  --region="$OFFHIRE_REGION" \
  --update-env-vars=OFFHIRE_ENABLE_LIVE=false
firebase deploy --only hosting:offhire --project "$OFFHIRE_PROJECT"
```

## Verified implementation and deployment limits

- **Cookies:** Firebase Hosting forwards only the cookie named `__session` to Cloud Run. Keep the anonymous demo identifier or authenticated Firebase session in that one cookie, with clear type handling. Do not overwrite an authenticated session during demo initialization. A separate CSRF cookie will not arrive at the server through Hosting; use the implemented origin/token checks that work through the proxy. [Hosting cookie behavior](https://firebase.google.com/docs/hosting/manage-cache), [session-cookie security](https://firebase.google.com/docs/auth/admin/manage-cookies)
- **Caching:** Send `Cache-Control: private, no-store` on session, identity, rental, receipt, job and other personalized/API responses. Do not apply a public cache rule to them. Immutable Next.js static assets can retain their separate asset-cache behavior. [Hosting caching](https://firebase.google.com/docs/hosting/manage-cache)
- **Timeouts and durability:** Hosting has a 60-second request limit even if Cloud Run is configured for longer. Dispatch CALL-E promptly, persist request identity before dispatch, and reconcile using bounded status requests or a webhook. Do not wait for the entire conversation inside one proxied request or rely on in-process work continuing after the HTTP response. [Hosting timeout](https://firebase.google.com/docs/hosting/cloud-run), [Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract)
- **Persistence:** Firestore holds durable requests, idempotency and user/workspace data. Cloud Run's local filesystem and process memory are not durable storage. Deny-all client rules do not block the attached Admin SDK service account; runtime IAM and server authorization remain necessary. [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam)
- **Sign-in authorization:** Check the Google provider, verified email, intended Firebase project/audience, allowlist and revocation on the server. Google sign-in authenticates identity; a successful Google login alone does not grant live-call permission.
- **Billing and proof:** Keep minimum instances at zero for the initial pilot, review billing alerts, and measure actual use. Resource creation, successful deployment, sign-in and a CALL-E connection check are separate checks; none alone establishes a verified phone conversation.

## Verify after deployment

- [ ] Actual Firebase project ID recorded.
- [ ] `offhire` Hosting site successfully created or existing ownership verified.
- [ ] Cloud Billing account consciously linked; budget alerts reviewed.
- [ ] `(default)` Firestore database is Native/Standard in the selected region.
- [ ] Runtime identity has datastore.user, the two Auth permissions, and only intended per-secret access.
- [ ] Build identity is separate and has no CALL-E secret access.
- [ ] Hosting target deploy reaches the intended Cloud Run revision.
- [ ] Rehearsal state survives requests and deploys; no live call from rehearsal.
- [ ] Allowed Google account can operate; unallowed account cannot dispatch.
- [ ] Hosting session persists as `__session`; API responses are not publicly cached.
- [ ] A separately approved live call completes and its actual outcome is retrieved, if live evidence is required.

## Local validation already completed

The Firebase build passes and its Node standalone artifact is exercised against local Firestore and Authentication emulators. Twenty Firestore persistence tests and thirty-one authentication/HTTP checks passed. These cover durable request identity, concurrent dispatch claims, budget reservations, stale-result protection, Google-provider/email allowlisting, revocation, CSRF and workspace isolation. The emulators do not prove production Google OAuth, project IAM or live CALL-E telephony. The existing D1 integration suite also passed.

Seven days is the anonymous cookie lifetime. Database expiry fields are metadata, not an automatic deletion policy; demo records remain until a deliberate cleanup is implemented. Do not claim automatic seven-day retention or set Firestore TTL on workspace parents alone, since child and separately stored records also need cleanup.

CALL-E CLI 0.5.1 is installed and authenticated on Shivam’s current Mac; plan_call, run_call and get_call_run are available. This brokered MCP login is separate from the SDK API-key setup in step 8. The CLI token remains in its private local cache and is not copied to Cloud Run or source control.
