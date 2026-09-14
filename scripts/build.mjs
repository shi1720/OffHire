import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["scripts/run-framework.mjs", "build", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
// Cloudflare's local preview can emit .dev.vars into build output. They are
// local runtime inputs, never deployment assets. Sites supplies its own secrets.
function stripLocalEnvironment(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (
      entry.name === ".env" ||
      entry.name.startsWith(".env.") ||
      entry.name === ".dev.vars" ||
      entry.name.startsWith(".dev.vars.")
    )
      fs.rmSync(filename, { recursive: true, force: true });
    else if (entry.isDirectory()) stripLocalEnvironment(filename);
  }
}
stripLocalEnvironment("dist");
console.log("Deployment output contains no local environment files.");
