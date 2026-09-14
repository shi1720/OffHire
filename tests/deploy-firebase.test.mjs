import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deploy,
  parseArgs,
  verifyHosted,
} from "../scripts/deploy-firebase.mjs";

const project = "offhire-test-123";
const appId = "1:123:web:offhire";
const options = {
  project,
  site: "offhire",
  owner: "operator@example.test",
  yes: true,
};
const clone = (value) => structuredClone(value);

// Fixtures follow the JSON envelopes returned by Firebase CLI 15.30.0 and
// Cloud Run v1/gcloud. Unknown commands fail, so tests cannot call the cloud.
function fixture(overrides = {}) {
  const state = {
    billing: true,
    googleEnabled: true,
    sites: [],
    databases: [],
    accounts: [],
    roles: [],
    apps: [],
    service: null,
    auth: {
      authorizedDomains: [
        `${project}.firebaseapp.com`,
        "existing.example.test",
      ],
    },
    ...overrides,
  };
  const events = [];
  const writes = [];
  const logs = [];
  const files = {
    "firebase.json": JSON.parse(
      readFileSync(new URL("../firebase.json", import.meta.url), "utf8"),
    ),
  };
  const mutate = (kind, args) => writes.push([kind, ...args]);
  const io = {
    read: (path) => clone(files[path] || {}),
    save: (path, value) => {
      files[path] = clone(value);
    },
    log: (message) => logs.push(message),
    login: async () => {},
    ask: async (label, fallback) => {
      if (fallback) return fallback;
      throw new Error(`Input required: ${label}`);
    },
    async gc(args) {
      events.push(["gc", ...args]);
      const starts = (prefix) =>
        args.slice(0, prefix.length).join(" ") === prefix.join(" ");
      if (starts(["config", "get-value", "account"]))
        return "operator@example.test";
      if (starts(["config", "get-value", "project"])) return project;
      assert.ok(
        args.includes(`--project=${project}`),
        "every cloud command is scoped to the chosen project",
      );
      if (starts(["projects", "describe"]))
        return { projectId: project, lifecycleState: "ACTIVE" };
      if (starts(["billing", "projects", "describe"]))
        return { billingEnabled: state.billing };
      if (starts(["services", "enable"])) {
        mutate("gc", args);
        return;
      }
      if (starts(["firestore", "databases", "list"]))
        return clone(state.databases);
      if (starts(["firestore", "databases", "create"])) {
        mutate("gc", args);
        assert.equal(state.databases.length, 0);
        state.databases.push({
          name: `projects/${project}/databases/(default)`,
          type: "FIRESTORE_NATIVE",
        });
        return;
      }
      if (starts(["iam", "service-accounts", "list"]))
        return clone(state.accounts);
      if (starts(["iam", "service-accounts", "create"])) {
        mutate("gc", args);
        const email = `${args[3]}@${project}.iam.gserviceaccount.com`;
        assert.ok(!state.accounts.some((item) => item.email === email));
        state.accounts.push({ email });
        return;
      }
      if (starts(["iam", "roles", "list"])) return clone(state.roles);
      if (starts(["iam", "roles", "create"])) {
        mutate("gc", args);
        state.roles.push({
          name: `projects/${project}/roles/offhireSessionAuth`,
        });
        return;
      }
      if (starts(["iam", "roles", "describe"]))
        return {
          stage: "GA",
          includedPermissions: [
            "firebaseauth.users.createSession",
            "firebaseauth.users.get",
          ],
        };
      if (starts(["projects", "add-iam-policy-binding"])) {
        mutate("gc", args);
        return;
      }
      if (starts(["run", "services", "list"]))
        return state.service ? [clone(state.service)] : [];
      if (starts(["run", "services", "describe"])) return clone(state.service);
      if (starts(["run", "deploy"])) {
        mutate("gc", args);
        if (state.failBuild) throw new Error("Cloud Build failed");
        const env =
          state.service?.spec?.template?.spec?.containers?.[0]?.env || [];
        const updates =
          files[".deploy/run-deploy-flags.json"]["--update-env-vars"];
        state.service = {
          metadata: { name: "offhire" },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    env: [
                      ...env.filter((item) => !(item.name in updates)),
                      ...Object.entries(updates).map(([name, value]) => ({
                        name,
                        value,
                      })),
                    ],
                  },
                ],
              },
            },
          },
        };
        return;
      }
      throw new Error(`Unexpected gcloud command: ${args.join(" ")}`);
    },
    async fb(args) {
      events.push(["fb", ...args]);
      assert.ok(
        args.includes(`--project=${project}`),
        "every Firebase command is explicitly scoped",
      );
      switch (args[0]) {
        case "hosting:sites:list":
          return { sites: clone(state.sites) };
        case "hosting:sites:create":
          if (state.siteUnavailable)
            throw new Error("Hosting site already owned by another project");
          mutate("fb", args);
          state.sites.push({ name: `projects/${project}/sites/${args[1]}` });
          return;
        case "hosting:sites:get":
          assert.ok(
            state.sites.some((site) => site.name.endsWith(`/${args[1]}`)),
          );
          return state.sites[0];
        case "apps:list":
          return clone(state.apps);
        case "apps:create":
          mutate("fb", args);
          state.apps.push({ appId, displayName: "OffHire" });
          return state.apps[0];
        case "apps:sdkconfig":
          return {
            sdkConfig: {
              appId,
              projectId: state.wrongWebProject ? "other-project" : project,
              authDomain: `${project}.firebaseapp.com`,
              apiKey: "public-web-config",
            },
          };
        case "target:apply":
        case "deploy":
          mutate("fb", args);
          return;
        default:
          throw new Error(`Unexpected Firebase command: ${args.join(" ")}`);
      }
    },
    async google(path, body) {
      events.push(["google", path, body]);
      assert.ok(path.startsWith(`projects/${project}/`));
      if (path.endsWith("/google.com"))
        return { enabled: state.googleEnabled, clientSecret: "must-not-leak" };
      if (body) {
        assert.equal(
          path,
          `projects/${project}/config?updateMask=authorizedDomains`,
        );
        mutate("google", [path, body]);
        state.auth = { ...state.auth, ...body };
      }
      return clone(state.auth);
    },
    async verify(origin, expectedProject) {
      events.push(["verify", origin, expectedProject]);
      if (state.failVerify) throw new Error("Verification failed");
    },
  };
  return { io, state, events, writes, logs, files };
}

test("first deployment provisions resources, keeps old Auth domains, then verifies Hosting", async () => {
  const f = fixture();
  const result = await deploy(f.io, options);
  assert.equal(result.url, "https://offhire.web.app");
  assert.equal(f.state.accounts.length, 2);
  assert.equal(f.state.databases.length, 1);
  assert.equal(f.state.apps.length, 1);
  assert.deepEqual(f.state.auth.authorizedDomains, [
    `${project}.firebaseapp.com`,
    "existing.example.test",
    "offhire.web.app",
  ]);
  const flags = f.files[".deploy/run-deploy-flags.json"]["--update-env-vars"];
  assert.equal(flags.OFFHIRE_ENABLE_LIVE, "false");
  assert.equal(flags.OFFHIRE_CALL_LIMIT, "5");
  assert.equal(flags.FIREBASE_WEB_API_KEY, "public-web-config");
  const grants = f.writes.filter((event) =>
    event.includes("add-iam-policy-binding"),
  );
  assert.equal(grants.length, 3);
  assert.ok(!JSON.stringify(grants).includes("roles/editor"));
  const build = f.events.findIndex(
    (event) => event[1] === "run" && event[2] === "deploy",
  );
  const publish = f.events.findIndex(
    (event) => event[0] === "fb" && event[1] === "deploy",
  );
  assert.ok(build < publish);
  assert.equal(f.events.at(-1)[0], "verify");
  assert.ok(!JSON.stringify([f.files, f.logs]).includes("must-not-leak"));
});

test("rerun reuses resources and preserves CALL-E secret refs, live flags, budget and destination", async () => {
  const f = fixture();
  await deploy(f.io, options);
  const env = f.state.service.spec.template.spec.containers[0].env;
  env.find((item) => item.name === "OFFHIRE_ENABLE_LIVE").value = "true";
  env.find((item) => item.name === "OFFHIRE_CALL_LIMIT").value = "17";
  env.push({
    name: "CALLE_API_KEY",
    valueFrom: { secretKeyRef: { name: "CALLE_API_KEY", key: "3" } },
  });
  env.push({ name: "OFFHIRE_ALLOWED_PHONES", value: "+12025550123" });
  const kept = clone(
    env.filter((item) =>
      [
        "CALLE_API_KEY",
        "OFFHIRE_ALLOWED_PHONES",
        "OFFHIRE_ENABLE_LIVE",
        "OFFHIRE_CALL_LIMIT",
      ].includes(item.name),
    ),
  );
  f.writes.length = 0;
  await deploy(f.io, { yes: true });
  assert.ok(
    !f.writes.some(
      (event) =>
        event.includes("create") ||
        event.includes("hosting:sites:create") ||
        event.includes("apps:create"),
    ),
  );
  assert.ok(!f.writes.some((event) => event[0] === "google"));
  for (const item of kept)
    assert.deepEqual(
      f.state.service.spec.template.spec.containers[0].env.find(
        (v) => v.name === item.name,
      ),
      item,
    );
  const flags = f.files[".deploy/run-deploy-flags.json"]["--update-env-vars"];
  assert.ok(!("CALLE_API_KEY" in flags));
  assert.ok(!("OFFHIRE_ENABLE_LIVE" in flags));
  assert.equal(f.state.accounts.length, 2);
});

for (const [title, overrides, pattern] of [
  ["billing is not linked", { billing: false }, /Billing is not enabled/],
  ["Google sign-in is disabled", { googleEnabled: false }, /Enable Google/],
  [
    "the requested URL belongs to someone else",
    { siteUnavailable: true },
    /already owned/,
  ],
])
  test(`stops before creating resources when ${title}`, async () => {
    const f = fixture(overrides);
    await assert.rejects(deploy(f.io, options), pattern);
    assert.equal(f.writes.length, 0);
  });

test("an API permission failure is not mistaken for an absent resource", async () => {
  const f = fixture();
  f.io.fb = async () => {
    throw new Error("PERMISSION_DENIED");
  };
  await assert.rejects(deploy(f.io, options), /PERMISSION_DENIED/);
  assert.equal(f.writes.length, 0);
});

test("a failed build does not publish Hosting and the next run resumes existing resources", async () => {
  const f = fixture({ failBuild: true });
  await assert.rejects(deploy(f.io, options), /Cloud Build failed/);
  assert.ok(
    !f.events.some((event) => event[0] === "fb" && event[1] === "deploy"),
  );
  assert.ok(!f.events.some((event) => event[0] === "verify"));
  f.state.failBuild = false;
  await deploy(f.io, { yes: true });
  assert.equal(f.state.accounts.length, 2);
  assert.equal(f.state.apps.length, 1);
  assert.equal(f.events.at(-1)[0], "verify");
});

test("multiple web apps require a choice and cross-project app IDs are refused", async () => {
  const f = fixture({ apps: [{ appId: "one" }, { appId: "two" }] });
  await assert.rejects(
    deploy(f.io, options),
    /Input required: Firebase Web App ID/,
  );
  await assert.rejects(
    deploy(f.io, { ...options, app: "foreign" }),
    /does not belong/,
  );
  assert.equal(f.writes.length, 0);
});

test("incorrect web config stops before deployment", async () => {
  const f = fixture({ wrongWebProject: true });
  await assert.rejects(deploy(f.io, options), /web config does not match/);
  assert.ok(
    !f.events.some((event) => event[1] === "run" && event[2] === "deploy"),
  );
});

test("operator list survives as a dictionary value, without comma flag splitting", async () => {
  const f = fixture();
  await deploy(f.io, {
    ...options,
    owner: "First@Example.test,second@example.test",
  });
  assert.equal(
    f.files[".deploy/run-deploy-flags.json"]["--update-env-vars"]
      .OFFHIRE_OWNER_EMAILS,
    "first@example.test,second@example.test",
  );
});

test("a verification failure never prints hosted success", async () => {
  const f = fixture({ failVerify: true });
  await assert.rejects(deploy(f.io, options), /Verification failed/);
  assert.ok(!f.logs.some((line) => line.includes("OffHire is hosted at")));
});

test("rejects invalid identifiers, unexpected flags and missing values", async () => {
  assert.throws(() => parseArgs(["--project"]), /needs a value/);
  assert.throws(() => parseArgs(["--force"]), /Unknown option/);
  const f = fixture();
  await assert.rejects(
    deploy(f.io, { ...options, site: "offhire.web.app" }),
    /Invalid Hosting site ID/,
  );
  await assert.rejects(
    deploy(f.io, {
      ...options,
      owner: "operator@example.test|OFFHIRE_ENABLE_LIVE=true",
    }),
    /Invalid operator email/,
  );
  assert.equal(f.writes.length, 0);
});

test("HTTP verification checks the served Firebase project and Firestore records", async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/health"))
      return Response.json({ application: "offhire", status: "ok" });
    if (url.endsWith("/api/auth/config"))
      return Response.json({
        provider: "firebase",
        configured: true,
        firebase: { projectId: project },
      });
    if (url.endsWith("/api/rentals?mode=demo"))
      return Response.json({ rentals: [{ id: "demo-rental" }] });
    return new Response("<title>OffHire</title>");
  };
  await verifyHosted(
    "https://offhire.web.app",
    project,
    request,
    async () => {},
  );
  assert.equal(calls.length, 4);
  assert.ok(calls.some((url) => url.endsWith("/api/rentals?mode=demo")));
});

test("HTTP verification retries a stale revision and fails if the project never matches", async () => {
  let reads = 0;
  const request = async (url) => {
    reads++;
    return Response.json(
      url.endsWith("/api/health")
        ? { application: "offhire", status: "ok" }
        : {
            provider: "firebase",
            configured: true,
            firebase: { projectId: "wrong-project" },
          },
    );
  };
  await assert.rejects(
    verifyHosted("https://offhire.web.app", project, request, async () => {}),
    /expected Firebase project/,
  );
  assert.equal(reads, 24);
});
