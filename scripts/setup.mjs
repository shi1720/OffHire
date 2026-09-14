// Build and migrate the LOCAL database. Never deploys or dials a number.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
function run(command, args) {
  const p = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (p.status !== 0) process.exit(p.status || 1);
}
run(process.execPath, ["scripts/build.mjs"]);
const config = JSON.parse(fs.readFileSync("dist/server/wrangler.json", "utf8"));
config.main = path.join(root, "dist/server/index.js");
if (config.assets) config.assets.directory = path.join(root, "dist/client");
config.d1_databases = config.d1_databases.map((d) => ({
  ...d,
  migrations_dir: path.join(root, "drizzle"),
}));
fs.mkdirSync(".sites-runtime", { recursive: true });
fs.writeFileSync(
  ".sites-runtime/local-migrations.json",
  JSON.stringify(config, null, 2),
);
run(process.execPath, [
  "--import",
  "./scripts/sites-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  ".sites-runtime/local-migrations.json",
  "--persist-to",
  process.env.OFFHIRE_LOCAL_DB_DIR || ".wrangler/state",
]);
console.log(
  "OffHire is ready. Run npm run dev, then open the printed local URL. Demo mode makes no calls.",
);
