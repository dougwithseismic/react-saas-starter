import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, eq, schema } from "@repo/db";
import { createApp } from "../../src/app.js";
import { readEnvironment } from "../../src/config/env.js";
import { createAuth } from "../../src/modules/auth/auth.js";

test("persisted account and organisation lifecycle enforces membership and owner permissions", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const env = readEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
    BETTER_AUTH_URL: "http://localhost:3001",
    APP_ORIGIN: "http://localhost:3001",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
  });
  const { db, pool } = createDatabase(env.DATABASE_URL);
  await db.delete(schema.rateLimit);
  const events: string[] = [];
  const app = createApp(
    db,
    createAuth(db, env, {
      capture(event) {
        events.push(event);
      },
      identify() {},
      async shutdown() {},
    }),
    env,
  );
  const suffix = crypto.randomUUID();
  const users: string[] = [];
  const orgs: string[] = [];
  async function request(
    path: string,
    body?: unknown,
    cookie?: string,
    origin = env.APP_ORIGIN,
  ) {
    return app.request(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function signup(name: string) {
    const email = `${name}-${suffix}@example.com`;
    const response = await request("sign-up/email", {
      email,
      name,
      password: "correct-horse-battery-staple",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    users.push(result.user.id);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return { cookie, email, id: result.user.id };
  }
  async function successful(path: string, body: unknown, cookie: string) {
    const response = await request(path, body, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    const owner = await signup("owner");
    const member = await signup("member");
    const outsider = await signup("outsider");
    assert.equal(
      (
        await request("sign-in/email", {
          email: owner.email,
          password: "correct-horse-battery-staple",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("get-session", undefined, owner.cookie)).status,
      200,
    );
    const me = await app.request("/api/me", {
      headers: { cookie: owner.cookie },
    });
    assert.equal(me.status, 200);
    assert.ok(me.headers.get("x-request-id"));
    const account = await me.json();
    assert.deepEqual(Object.keys(account), ["user"]);
    assert.deepEqual(Object.keys(account.user).sort(), [
      "email",
      "emailVerified",
      "id",
      "image",
      "name",
    ]);
    const denied = await app.request("/api/me");
    assert.equal(denied.status, 401);
    const error = await denied.json();
    assert.equal(error.error.code, "UNAUTHORIZED");
    assert.equal(error.error.requestId, denied.headers.get("x-request-id"));
    const org = await successful(
      "organization/create",
      { name: "Kestrel", slug: `kestrel-${suffix}` },
      owner.cookie,
    );
    orgs.push(org.id);
    assert.deepEqual(
      await (
        await request("organization/list", undefined, outsider.cookie)
      ).json(),
      [],
    );
    assert.equal(
      (
        await request(
          `organization/get-full-organization?organizationId=${org.id}`,
          undefined,
          outsider.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "organization/update",
          { organizationId: org.id, data: { name: "Stolen" } },
          outsider.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "organization/delete",
          { organizationId: org.id },
          outsider.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "organization/leave",
          { organizationId: org.id },
          owner.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "delete-user",
          { password: "correct-horse-battery-staple" },
          owner.cookie,
        )
      ).status,
      400,
    );
    const invitation = await successful(
      "organization/invite-member",
      { organizationId: org.id, email: member.email, role: "member" },
      owner.cookie,
    );
    assert.equal(
      (
        await request(
          "organization/accept-invitation",
          { invitationId: invitation.id },
          outsider.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "organization/accept-invitation",
          { invitationId: invitation.id },
          member.cookie,
        )
      ).status,
      403,
    );
    await db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, member.id));
    await successful(
      "organization/accept-invitation",
      { invitationId: invitation.id },
      member.cookie,
    );
    assert.equal(
      (
        await request(
          "organization/update",
          { organizationId: org.id, data: { name: "No" } },
          member.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "organization/invite-member",
          { organizationId: org.id, email: outsider.email, role: "admin" },
          member.cookie,
        )
      ).status,
      403,
    );
    const full = await (
      await request(
        `organization/get-full-organization?organizationId=${org.id}`,
        undefined,
        owner.cookie,
      )
    ).json();
    const membership = full.members.find(
      (entry: { userId: string }) => entry.userId === member.id,
    );
    assert.ok(membership);
    await successful(
      "organization/update-member-role",
      { organizationId: org.id, memberId: membership.id, role: "admin" },
      owner.cookie,
    );
    await successful(
      "organization/update",
      { organizationId: org.id, data: { name: "Updated" } },
      member.cookie,
    );
    const cancel = await successful(
      "organization/invite-member",
      { organizationId: org.id, email: outsider.email, role: "member" },
      member.cookie,
    );
    await successful(
      "organization/cancel-invitation",
      { invitationId: cancel.id },
      owner.cookie,
    );
    assert.equal(
      (
        await request(
          "organization/accept-invitation",
          { invitationId: cancel.id },
          outsider.cookie,
        )
      ).status,
      400,
    );
    const reject = await successful(
      "organization/invite-member",
      { organizationId: org.id, email: outsider.email, role: "member" },
      owner.cookie,
    );
    await db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, outsider.id));
    await successful(
      "organization/reject-invitation",
      { invitationId: reject.id },
      outsider.cookie,
    );
    await successful(
      "organization/remove-member",
      { organizationId: org.id, memberIdOrEmail: membership.id },
      owner.cookie,
    );
    await successful("update-user", { name: "New name" }, member.cookie);
    const sessions = await (
      await request("list-sessions", undefined, member.cookie)
    ).json();
    assert.ok(sessions.length > 0);
    await successful(
      "change-password",
      {
        currentPassword: "correct-horse-battery-staple",
        newPassword: "new-correct-horse-battery-staple",
        revokeOtherSessions: true,
      },
      member.cookie,
    );
    await successful(
      "organization/delete",
      { organizationId: org.id },
      owner.cookie,
    );
    await successful(
      "delete-user",
      { password: "correct-horse-battery-staple" },
      owner.cookie,
    );
    assert.ok(events.includes("account.created"));
    assert.ok(events.includes("account.updated"));
    await request("sign-out", {}, member.cookie);
    assert.ok(events.includes("session.deleted"));
    assert.ok(events.includes("organization.created"));
    assert.ok(events.includes("organization.invitation_accepted"));
    assert.ok(events.includes("account.deleted"));
    const spec = await (await app.request("/openapi.json")).json();
    assert.equal(spec.info.title, "Account API");
    assert.ok(spec.paths["/api/me"]);
    assert.ok(spec.paths["/health"]);
    assert.ok(
      Object.keys(spec.paths).some((path) =>
        path.includes("organization/create"),
      ),
    );
    assert.equal((await app.request("/api/workspaces")).status, 404);
    assert.equal((await app.request("/health/ready")).status, 200);
  } finally {
    for (const id of orgs)
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, id));
    for (const id of users)
      await db.delete(schema.user).where(eq(schema.user.id, id));
    await pool.end();
  }
});

test("database serializes concurrent final owner removals", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const { db, pool } = createDatabase(process.env.TEST_DATABASE_URL as string);
  const orgId = crypto.randomUUID();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  try {
    await db.insert(schema.user).values([
      { id: first, name: "First", email: `${first}@example.com` },
      { id: second, name: "Second", email: `${second}@example.com` },
    ]);
    await db
      .insert(schema.organization)
      .values({ id: orgId, name: "Concurrent", slug: orgId });
    await db.insert(schema.member).values([
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: first,
        role: "owner,admin",
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: second,
        role: "owner",
      },
    ]);
    const results = await Promise.allSettled([
      db.delete(schema.user).where(eq(schema.user.id, first)),
      db.delete(schema.user).where(eq(schema.user.id, second)),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const remaining = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, orgId));
    assert.equal(remaining.length, 1);
  } finally {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, orgId));
    for (const id of [first, second])
      await db.delete(schema.user).where(eq(schema.user.id, id));
    await pool.end();
  }
});
