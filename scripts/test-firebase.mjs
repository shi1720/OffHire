import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"])
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || ""))
    throw new Error(
      `Run through Firebase emulators:exec; ${name} must name a local emulator.`,
    );
const env = {
  ...process.env,
  OFFHIRE_RUNTIME: "firebase",
  GOOGLE_CLOUD_PROJECT: "demo-offhire",
  GCLOUD_PROJECT: "demo-offhire",
  OFFHIRE_PUBLIC_ORIGIN: "http://127.0.0.1:3400",
  OFFHIRE_OWNER_EMAILS: "operator@example.test",
  OFFHIRE_ENABLE_LIVE: "false",
  CALLE_API_KEY: "",
  FIREBASE_WEB_API_KEY: "demo-web-key",
  HOSTNAME: "127.0.0.1",
  PORT: "3400",
};
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}`)),
    );
  });
mkdirSync("work", { recursive: true });
const log = openSync("work/firebase-server.log", "w");
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env,
  stdio: ["ignore", log, log],
});
let startupError;
server.once("error", (error) => {
  startupError = error;
});
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (startupError) throw startupError;
    if (server.exitCode !== null)
      throw new Error(
        "Standalone server stopped; inspect work/firebase-server.log",
      );
    try {
      if ((await fetch(`${env.OFFHIRE_PUBLIC_ORIGIN}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw new Error("Standalone server did not become ready");
  await run([
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "tests/firestore/persistence.test.ts",
  ]);
  await run(["tests/firebase-auth/run.mjs"]);
  await run(["tests/firebase-auth/http.mjs"]);
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  closeSync(log);
}
