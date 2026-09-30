import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, schema } from "@repo/db";
import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import type { Environment } from "../../config/env.js";
import { CLIENT_IP_HEADER } from "../../lib/client-ip.js";
import { guardAccountDeletion } from "../account/policy.js";
import { type AnalyticsSink, noopAnalytics } from "../analytics/analytics.js";
import { createOrganizationPlugin } from "../organizations/plugin.js";
import { createEmailSender } from "./email.js";
export function createAuth(
  db: Database,
  env: Environment,
  analytics: AnalyticsSink = noopAnalytics,
) {
  const sendEmail = createEmailSender(env);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) =>
        sendEmail({
          kind: "resetPassword",
          email: user.email,
          url,
          name: user.name,
        }),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail({
          kind: "verifyEmail",
          email: user.email,
          url,
          name: user.name,
        }),
    },
    user: {
      changeEmail: { enabled: true },
      deleteUser: {
        enabled: true,
        beforeDelete: guardAccountDeletion(db),
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            analytics.identify(user.id);
            analytics.capture("account.created", user.id);
          },
        },
        update: {
          after: async (user) => {
            analytics.capture("account.updated", user.id);
          },
        },
        delete: {
          after: async (user) => {
            analytics.capture("account.deleted", user.id);
          },
        },
      },
      session: {
        delete: {
          after: async (session) => {
            analytics.capture("session.deleted", session.userId);
          },
        },
        create: {
          after: async (session) => {
            analytics.capture("session.created", session.userId);
          },
        },
      },
    },
    plugins: [
      createOrganizationPlugin(db, env, sendEmail, analytics),
      openAPI({ disableDefaultReference: true }),
    ],
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
