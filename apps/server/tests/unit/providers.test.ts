import assert from "node:assert/strict";
import test from "node:test";
import { readEnvironment } from "../../src/config/env.js";
import {
  noopAnalytics,
  protectAnalytics,
} from "../../src/modules/analytics/analytics.js";
import {
  createEmailSender,
  missingEmailSettings,
} from "../../src/modules/auth/email.js";

const env = readEnvironment({
  DATABASE_URL: "postgres://localhost/test",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:4300",
  APP_ORIGIN: "http://localhost:4300",
  LOOPS_API_KEY: "test-key",
  LOOPS_RESET_PASSWORD_TEMPLATE_ID: "reset",
  LOOPS_VERIFY_EMAIL_TEMPLATE_ID: "verify",
  LOOPS_INVITATION_TEMPLATE_ID: "invite",
});
test("Loops sends semantic template variables without marketing audience enrollment", async () => {
  const requests: Record<string, unknown>[] = [];
  const transport = (async (url, options) => {
    assert.equal(url, "https://app.loops.so/api/v1/transactional");
    assert.ok(options?.signal);
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({ success: true });
  }) as typeof fetch;
  const sender = createEmailSender(env, transport);
  await sender({
    kind: "resetPassword",
    email: "test@example.com",
    name: "Sam",
    url: "https://example.com/reset",
  });
  await sender({
    kind: "verifyEmail",
    email: "test@example.com",
    name: "Sam",
    url: "https://example.com/verify",
  });
  await sender({
    kind: "invitation",
    email: "test@example.com",
    name: "Sam",
    url: "https://example.com/invite",
    organizationName: "Team",
  });
  assert.deepEqual(
    requests.map((r) => r.transactionalId),
    ["reset", "verify", "invite"],
  );
  assert.deepEqual(requests[2], {
    transactionalId: "invite",
    email: "test@example.com",
    addToAudience: false,
    dataVariables: {
      url: "https://example.com/invite",
      name: "Sam",
      organizationName: "Team",
    },
  });
});
test("Loops missing template and provider outage return safe failures", async () => {
  const message = {
    kind: "resetPassword" as const,
    email: "secret@example.com",
    name: "Name",
    url: "https://example.com/token",
  };
  for (const transport of [
    (async () => {
      throw new Error("secret-provider-response");
    }) as typeof fetch,
    (async () =>
      new Response("secret-provider-response", {
        status: 503,
      })) as typeof fetch,
    (async () => Response.json({ success: false })) as typeof fetch,
  ])
    await assert.rejects(
      createEmailSender(env, transport)(message),
      (error) =>
        String(error).includes("Email delivery failed") &&
        !String(error).includes("secret-provider-response"),
    );
  await assert.rejects(
    createEmailSender({ ...env, LOOPS_RESET_PASSWORD_TEMPLATE_ID: undefined })(
      message,
    ),
    /not configured/,
  );
});
test("missing Loops settings are named so a bare deploy reports them", () => {
  assert.deepEqual(missingEmailSettings(env), []);
  assert.deepEqual(
    missingEmailSettings({
      ...env,
      LOOPS_API_KEY: undefined,
      LOOPS_INVITATION_TEMPLATE_ID: undefined,
    }),
    ["LOOPS_API_KEY", "LOOPS_INVITATION_TEMPLATE_ID"],
  );
});
test("analytics abstraction forwards semantic payloads and isolates provider failures", async () => {
  const records: unknown[] = [];
  let warnings = 0;
  const logger = {
    warn: () => {
      warnings++;
    },
  };
  const sink = protectAnalytics(
    {
      capture: (...args) => {
        records.push(args);
      },
      identify: (id) => {
        records.push(id);
      },
      async shutdown() {
        records.push("shutdown");
      },
    },
    logger,
  );
  sink.capture("organization.created", "user-id", { organizationId: "org-id" });
  sink.identify("user-id");
  await sink.shutdown();
  assert.deepEqual(records, [
    ["organization.created", "user-id", { organizationId: "org-id" }],
    "user-id",
    "shutdown",
  ]);
  const failing = protectAnalytics(
    {
      capture() {
        throw new Error("secret");
      },
      identify() {
        throw new Error("secret");
      },
      async shutdown() {
        throw new Error("secret");
      },
    },
    logger,
  );
  failing.capture("account.created", "id");
  failing.identify("id");
  await failing.shutdown();
  assert.equal(warnings, 3);
  await noopAnalytics.shutdown();
});

test("analytics drops undeclared properties at runtime", () => {
  let captured: unknown;
  const sink = protectAnalytics(
    {
      capture(_event, _id, properties) {
        captured = properties;
      },
      identify() {},
      async shutdown() {},
    },
    { warn() {} },
  );
  const unsafe = {
    organizationId: "org",
    role: "member",
    email: "secret@example.com",
    token: "secret",
  };
  sink.capture("organization.created", "id", unsafe);
  assert.deepEqual(captured, { organizationId: "org", role: "member" });
});
