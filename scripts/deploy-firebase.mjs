#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGION = "us-central1"; // Must match firebase.json's Cloud Run rewrite.
const SERVICE = "offhire";
const STATE = ".deploy/firebase-deploy.json";
const AUTH_PERMISSIONS = [
  "firebaseauth.users.createSession",
  "firebaseauth.users.get",
];
const SERVICES = [
  "run",
  "cloudbuild",
  "artifactregistry",
  "firestore",
  "identitytoolkit",
  "secretmanager",
  "iam",
  "cloudresourcemanager",
  "firebasehosting",
  "storage",
].map((name) => `${name}.googleapis.com`);

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--yes", "--help"].includes(arg)) options[arg.slice(2)] = true;
    else if (["--project", "--site", "--owner", "--app"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
    } else
      throw new Error(
        `Unknown option: ${arg}. Run npm run deploy:firebase -- --help.`,
      );
  }
  return options;
}

function validate(kind, value, pattern) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Invalid ${kind}: ${value || "(empty)"}.`);
  return value;
}

function ownerEmails(value) {
  const emails = value.split(",").map((email) => email.trim().toLowerCase());
  for (const email of emails)
    validate("operator email", email, /^[^\s@|=,]+@[^\s@|=,]+\.[^\s@|=,]+$/);
  return [...new Set(emails)].join(",");
}

// Injected I/O lets tests exercise first deploy, reruns and failure boundaries
// without creating real cloud resources or reading developer credentials.
export async function deploy(io, options = {}) {
  const saved = io.read(STATE);
  const rc = io.read(".firebaserc");
  const config = io.read("firebase.json");
  const rewrite = config.hosting?.rewrites?.find((entry) => entry.run)?.run;
  if (
    config.hosting?.target !== SERVICE ||
    rewrite?.serviceId !== SERVICE ||
    rewrite?.region !== REGION ||
    rewrite?.pinTag !== true
  )
    throw new Error(
      "firebase.json must retain the supplied offhire/us-central1 rewrite with pinTag: true.",
    );

  await io.login(options.yes);
  const account = await io.gc(["config", "get-value", "account"]);
  const currentProject = await io.gc(["config", "get-value", "project"]);
  const suggestedProject =
    saved.project ||
    rc.projects?.production ||
    rc.projects?.default ||
    (currentProject !== "(unset)" ? currentProject : "");
  const project = validate(
    "Firebase project ID",
    options.project ||
      (await io.ask(
        "Existing Firebase project ID",
        suggestedProject,
        options.yes,
      )),
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  );
  const prior = saved.project === project ? saved : {};
  const projectArgs = [`--project=${project}`];
  const gc = (args, json = false) => io.gc([...args, ...projectArgs], json);
  const fb = (args, json = false) => io.fb([...args, ...projectArgs], json);

  io.log(`\nChecking Firebase project ${project}…`);
  const details = await gc(["projects", "describe", project], true);
  if (details.projectId !== project || details.lifecycleState !== "ACTIVE")
    throw new Error("The selected Google Cloud project is not active.");
  const billing = await gc(["billing", "projects", "describe", project], true);
  if (!billing.billingEnabled)
    throw new Error(
      `Billing is not enabled. Link your chosen billing account in https://console.firebase.google.com/project/${project}/usage/details, then rerun. The script does not choose or link a billing account.`,
    );

  const { sites } = await fb(["hosting:sites:list"], true);
  const site = validate(
    "Hosting site ID",
    options.site ||
      prior.site ||
      rc.targets?.[project]?.hosting?.offhire?.[0] ||
      (await io.ask(
        "Hosting site ID (the name before .web.app)",
        "offhire",
        options.yes,
      )),
    /^[a-z0-9](?:[a-z0-9-]{2,28}[a-z0-9])$/,
  );
  const origin = `https://${site}.web.app`;
  const googlePath = `projects/${project}/defaultSupportedIdpConfigs/google.com`;
  const google = await io.google(googlePath);
  if (google.enabled !== true)
    throw new Error(
      `Enable Google in Firebase Authentication → Sign-in method for ${project}, then rerun.`,
    );

  const owner = ownerEmails(
    options.owner ||
      prior.owner ||
      (await io.ask(
        "Google email allowed to operate OffHire",
        options.yes ? "" : account,
        options.yes,
      )),
  );
  const apps = await fb(["apps:list", "WEB"], true);
  let app = options.app || prior.app;
  if (app && !apps.some((item) => item.appId === app))
    throw new Error(
      `Web app ${app} does not belong to ${project}. Choose an App ID from Firebase project settings with --app.`,
    );
  if (!app && apps.length === 1) app = apps[0].appId;
  if (!app && apps.length > 1) {
    const named = apps.filter(
      (item) => item.displayName?.toLowerCase() === "offhire",
    );
    if (named.length === 1) app = named[0].appId;
    else {
      io.log(
        apps
          .map((item) => `${item.displayName || "Web app"}: ${item.appId}`)
          .join("\n"),
      );
      app = await io.ask(
        "Firebase Web App ID from the list above",
        "",
        options.yes,
      );
      if (!apps.some((item) => item.appId === app))
        throw new Error("Choose one of the listed Web App IDs.");
    }
  }
  io.log(
    `\nDeploying OffHire\n  Project:  ${project}\n  URL:      ${origin}\n  Operator: ${owner}\n  Region:   ${REGION}\n\nThis provisions the runtime/build identities and publishes the app using the project's existing billing account. First deploy starts with live calling disabled.\n`,
  );
  io.save(STATE, { project, site, owner, ...(app ? { app } : {}) });

  // Reserve/verify the requested site before starting a paid container build.
  // A permission/network error is never interpreted as an available name.
  if (!sites.some((item) => item.name?.split("/").pop() === site)) {
    io.log(`Creating Hosting site ${site}…`);
    await fb(["hosting:sites:create", site]);
  }
  await fb(["hosting:sites:get", site], true);
  io.log("Enabling deployment services…");
  await gc(["services", "enable", ...SERVICES]);

  const databases = await gc(["firestore", "databases", "list"], true);
  const database = databases.find((item) =>
    item.name?.endsWith("/databases/(default)"),
  );
  if (database && database.type !== "FIRESTORE_NATIVE")
    throw new Error(
      "The existing default database is not Firestore Native mode. It has not been changed.",
    );
  if (!database) {
    io.log(`Creating the default Firestore database in ${REGION}…`);
    await gc([
      "firestore",
      "databases",
      "create",
      "--database=(default)",
      `--location=${REGION}`,
      "--type=firestore-native",
      "--edition=standard",
    ]);
  }

  const runtime = `offhire-runtime@${project}.iam.gserviceaccount.com`;
  const builder = `offhire-build@${project}.iam.gserviceaccount.com`;
  const accounts = await gc(["iam", "service-accounts", "list"], true);
  for (const [id, email, label] of [
    ["offhire-runtime", runtime, "OffHire runtime"],
    ["offhire-build", builder, "OffHire container build"],
  ]) {
    const existing = accounts.find((item) => item.email === email);
    if (existing?.disabled)
      throw new Error(
        `${email} is disabled. Resolve this in IAM before rerunning.`,
      );
    if (!existing)
      await gc([
        "iam",
        "service-accounts",
        "create",
        id,
        `--display-name=${label}`,
      ]);
  }
  const roleName = `projects/${project}/roles/offhireSessionAuth`;
  const roles = await gc(["iam", "roles", "list", "--show-deleted"], true);
  const role = roles.find((item) => item.name === roleName);
  if (role?.deleted)
    throw new Error(
      "The offhireSessionAuth role was deleted; restore it in IAM before rerunning.",
    );
  if (role) {
    const definition = await gc(
      ["iam", "roles", "describe", "offhireSessionAuth"],
      true,
    );
    if (
      definition.stage === "DISABLED" ||
      AUTH_PERMISSIONS.some((p) => !definition.includedPermissions?.includes(p))
    )
      throw new Error(
        "The existing offhireSessionAuth role is disabled or lacks required Auth permissions. See docs/firebase-deployment.md, step 4.",
      );
  } else {
    await gc([
      "iam",
      "roles",
      "create",
      "offhireSessionAuth",
      "--title=OffHire session authentication",
      "--description=Create Firebase session cookies and check user revocation state",
      `--permissions=${AUTH_PERMISSIONS.join(",")}`,
      "--stage=GA",
    ]);
  }
  io.log("Granting runtime and build permissions…");
  for (const [email, roleId] of [
    [runtime, "roles/datastore.user"],
    [runtime, roleName],
    [builder, "roles/run.builder"],
  ])
    await gc([
      "projects",
      "add-iam-policy-binding",
      project,
      `--member=serviceAccount:${email}`,
      `--role=${roleId}`,
      "--condition=None",
    ]);

  if (!app) {
    const created = await fb(["apps:create", "WEB", "OffHire"], true);
    app = created.appId;
  }
  const web = await fb(["apps:sdkconfig", "WEB", app], true);
  const sdk = web.sdkConfig || JSON.parse(web.fileContents);
  if (
    sdk.projectId !== project ||
    !sdk.apiKey ||
    sdk.authDomain !== `${project}.firebaseapp.com`
  )
    throw new Error(
      "The Firebase web config does not match this project's expected auth domain.",
    );
  io.save(STATE, { project, site, owner, app });

  const authPath = `projects/${project}/config`;
  const authConfig = await io.google(authPath);
  const domains = new Set(authConfig.authorizedDomains || []);
  if (!domains.has(`${site}.web.app`)) {
    domains.add(`${site}.web.app`);
    await io.google(`${authPath}?updateMask=authorizedDomains`, {
      authorizedDomains: [...domains],
    });
    io.log(`Added ${site}.web.app to Firebase Auth authorized domains.`);
  }

  const services = await gc(
    ["run", "services", "list", `--region=${REGION}`],
    true,
  );
  const listed = services.find((item) => item.metadata?.name === SERVICE);
  const existing = listed
    ? await gc(
        ["run", "services", "describe", SERVICE, `--region=${REGION}`],
        true,
      )
    : null;
  const containers = existing?.spec?.template?.spec?.containers || [];
  if (existing && containers.length !== 1)
    throw new Error(
      "The existing Cloud Run service does not have the expected single-container configuration. It has not been redeployed.",
    );
  const env = containers[0]?.env || [];
  const updates = {
    OFFHIRE_RUNTIME: "firebase",
    GOOGLE_CLOUD_PROJECT: project,
    OFFHIRE_PUBLIC_ORIGIN: origin,
    FIREBASE_WEB_API_KEY: sdk.apiKey,
    OFFHIRE_OWNER_EMAILS: owner,
    ...(!env.some((item) => item.name === "OFFHIRE_ENABLE_LIVE")
      ? { OFFHIRE_ENABLE_LIVE: "false" }
      : {}),
    ...(!env.some((item) => item.name === "OFFHIRE_CALL_LIMIT")
      ? { OFFHIRE_CALL_LIMIT: "5" }
      : {}),
  };
  // Only non-secret app settings go into this file. update-env-vars preserves
  // CALL-E secrets, destination allowlists, budgets and current live settings.
  for (const value of Object.values(updates))
    if (value.includes("|") || /[\r\n]/.test(value))
      throw new Error("Invalid runtime configuration value.");
  io.save(".deploy/run-deploy-flags.json", {
    "--update-env-vars": updates,
  });
  io.log(
    "Building and deploying Cloud Run (the first build can take several minutes)…",
  );
  await gc([
    "run",
    "deploy",
    SERVICE,
    "--source=.",
    `--region=${REGION}`,
    `--service-account=${runtime}`,
    `--build-service-account=projects/${project}/serviceAccounts/${builder}`,
    "--allow-unauthenticated",
    "--port=8080",
    "--cpu=1",
    "--memory=512Mi",
    "--min=0",
    "--max=3",
    "--concurrency=20",
    "--timeout=60s",
    "--flags-file=.deploy/run-deploy-flags.json",
  ]);
  await fb(["target:apply", "hosting", SERVICE, site]);
  io.log("Publishing Firestore rules and the Firebase Hosting URL…");
  await fb([
    "deploy",
    "--only",
    "firestore:rules,firestore:indexes,hosting:offhire",
  ]);
  await io.verify(origin, project);
  io.log(
    `\nOffHire is hosted at ${origin}\nSign in with ${owner}.\nRun npm run deploy:firebase again to publish updates. CALL-E secret setup remains separate; this script never places a call.`,
  );
  return { project, site, owner, app, url: origin };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function command(binary, args, { capture = true, optional = false } = {}) {
  const result = spawnSync(binary, args, {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
  });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    throw new Error(
      `${binary} ${args[0]} ${args[1] || ""} failed. ${result.error?.message || result.stderr?.trim() || "See command output above."}`,
    );
  }
  return result.stdout?.trim() || "";
}

export async function verifyHosted(
  origin,
  project,
  request = fetch,
  pause = delay,
) {
  let reason = "Hosting is not ready yet";
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const get = (path) =>
        request(`${origin}${path}`, {
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        });
      const health = await get("/api/health");
      const status = await health.json();
      if (
        !health.ok ||
        status.application !== "offhire" ||
        status.status !== "ok"
      )
        throw new Error("OffHire health check failed");
      const config = await get("/api/auth/config");
      const auth = await config.json();
      if (
        !config.ok ||
        auth.provider !== "firebase" ||
        !auth.configured ||
        auth.firebase?.projectId !== project
      )
        throw new Error(
          "The hosted app is not using the expected Firebase project",
        );
      const page = await get("/");
      if (!page.ok || !(await page.text()).includes("OffHire"))
        throw new Error("The app page did not render");
      const rentals = await get("/api/rentals?mode=demo");
      const records = await rentals.json();
      if (
        !rentals.ok ||
        !Array.isArray(records.rentals) ||
        records.rentals.length < 1
      )
        throw new Error(
          "The hosted app could not load its Firestore demo records",
        );
      return;
    } catch (error) {
      reason = error.message;
    }
    if (attempt < 11) await pause(5000);
  }
  throw new Error(
    `Deployment commands completed, but verification of ${origin} failed: ${reason}. Inspect Cloud Run logs and rerun; no verified success is being claimed.`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      `Usage: npm run deploy:firebase [-- --project PROJECT_ID --site offhire --owner you@gmail.com]\n\nUses your existing Firebase project and Google sign-in. Creates/reuses runtime and build service accounts, discovers web config, authorizes the Hosting domain, and deploys Cloud Run + Firebase Hosting + Firestore rules.\n\nRequires Node 22.13+ and gcloud (preinstalled in Google Cloud Shell). Firebase CLI is downloaded through npx automatically. Billing must already be linked; the script never selects a billing account. No npm ci or local Docker is needed to deploy.\n\nOptions: --project ID  --site ID  --owner EMAIL[,EMAIL]  --app WEB_APP_ID\n         --yes (use supplied/saved settings without prompts; does not accept missing values)\n         --help\n\nSettings are saved in ignored .deploy/firebase-deploy.json. First deployment disables live calls. Redeployments preserve live flags, destination allowlists, and existing CALL-E secrets. Never put a secret in these options.`,
    );
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw new Error(
      "Use Node.js 22.13 or newer (Google Cloud Shell supports Node). ",
    );
  if (command("gcloud", ["version"], { optional: true }) === null)
    throw new Error(
      "gcloud is missing. Run this command in https://shell.cloud.google.com (gcloud is preinstalled), or install https://cloud.google.com/sdk/docs/install first.",
    );
  let readline;
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const fb = async (args, json = false) => {
    const output = command(
      npx,
      [
        "--yes",
        "firebase-tools@15.30.0",
        ...args,
        ...(json ? ["--json"] : []),
        "--non-interactive",
      ],
      { capture: json },
    );
    if (!json) return output;
    const result = JSON.parse(output);
    if (result.status !== "success")
      throw new Error(`Firebase ${args[0]} failed.`);
    return result.result;
  };
  try {
    await deploy(
      {
        read: readJson,
        save(path, value) {
          mkdirSync(resolve(ROOT, ".deploy"), { recursive: true, mode: 0o700 });
          const destination = resolve(ROOT, path);
          writeFileSync(
            `${destination}.tmp`,
            `${JSON.stringify(value, null, 2)}\n`,
            { mode: 0o600 },
          );
          renameSync(`${destination}.tmp`, destination);
        },
        log: console.log,
        async ask(label, fallback, nonInteractive) {
          if (nonInteractive) {
            if (fallback) return fallback;
            throw new Error(
              `${label} is required. Supply the corresponding flag or run interactively.`,
            );
          }
          if (!process.stdin.isTTY)
            throw new Error(
              `Run in an interactive terminal or supply --yes and the required flags. Missing: ${label}.`,
            );
          readline ||= createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = (
            await readline.question(
              `${label}${fallback ? ` [${fallback}]` : ""}: `,
            )
          ).trim();
          if (!answer && !fallback) throw new Error(`${label} is required.`);
          return answer || fallback;
        },
        async login(nonInteractive) {
          const accounts = JSON.parse(
            command("gcloud", [
              "auth",
              "list",
              "--filter=status:ACTIVE",
              "--format=json",
            ]),
          );
          if (!accounts.length) {
            if (nonInteractive) throw new Error("Run gcloud auth login first.");
            command("gcloud", ["auth", "login"], { capture: false });
          }
          const loggedIn = await fb(["login:list"], true);
          if (!loggedIn?.length) {
            if (nonInteractive)
              throw new Error(
                "Run npx --yes firebase-tools@15.30.0 login first.",
              );
            command(
              npx,
              ["--yes", "firebase-tools@15.30.0", "login", "--no-localhost"],
              { capture: false },
            );
          }
        },
        gc(args, json = false) {
          const capture = json || args[0] === "config";
          const output = command(
            "gcloud",
            [...args, "--quiet", ...(json ? ["--format=json"] : [])],
            { capture },
          );
          return json ? JSON.parse(output) : output;
        },
        fb,
        async google(path, body) {
          // Short-lived OAuth token stays in process memory, never an argv, log or file.
          const token = command("gcloud", [
            "auth",
            "print-access-token",
            "--quiet",
          ]);
          const response = await fetch(
            `https://identitytoolkit.googleapis.com/admin/v2/${path}`,
            {
              method: body ? "PATCH" : "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
              signal: AbortSignal.timeout(30000),
            },
          );
          if (!response.ok)
            throw new Error(
              `Firebase Auth configuration request failed (HTTP ${response.status}). Check Google sign-in is enabled and your gcloud account has firebaseauth.configs.get/update for the selected project. No credentials were logged.`,
            );
          return response.json();
        },
        verify: verifyHosted,
      },
      options,
    );
  } finally {
    readline?.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      `\nDeployment stopped: ${error.message}\nFix the reported issue, then rerun the same command. Existing resources and saved settings are reused.`,
    );
    process.exitCode = 1;
  });
}
