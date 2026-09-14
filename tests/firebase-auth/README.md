# Firebase authentication boundary tests

These scripts use the actual application code and local Firebase emulators. They never dispatch CALL-E jobs and do not reset the shared emulator database.

Start Auth at `127.0.0.1:9199` and Firestore at `127.0.0.1:8180`, with Firebase project `demo-offhire`, then run:

```sh
node tests/firebase-auth/run.mjs
```

The source suite builds the API route and session module with esbuild. It substitutes only the unavailable Cloudflare environment import with `process.env`; Firebase Admin Auth and Firestore remain real implementations talking to the local emulators. Each run creates unique synthetic accounts and workspace data. The account revocation and disable tests affect only that run's unique account. The suite reports emulator tests as skipped when those services are unavailable.

To exercise the production Next server via HTTP, first run the server on port 3400 with:

```text
OFFHIRE_RUNTIME=firebase
GOOGLE_CLOUD_PROJECT=demo-offhire
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180
OFFHIRE_PUBLIC_ORIGIN=http://127.0.0.1:3400
OFFHIRE_OWNER_EMAILS=operator@example.test
FIREBASE_WEB_API_KEY=demo-web-key
OFFHIRE_ENABLE_LIVE=false
```

Then run:

```sh
node tests/firebase-auth/http.mjs
```

The HTTP suite checks `/api/auth/config` for the emulator project before signing in. It does not revoke or disable the shared synthetic operator account. Tests require manual cookie forwarding over local HTTP; this does not establish browser cookie or Google popup behavior.

Ignored `.runtime/` contains generated source bundles and JSON result summaries. Authentication emulator JWT signatures are intentionally unsigned. Passing these tests establishes server policy and integration behavior, not production Google authentication or cryptographic verification against Google's public keys. Never configure emulator environment variables on a production deployment.
