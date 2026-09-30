import { z } from "zod";
import { parseTrustedProxyIps } from "../lib/client-ip.js";
export const environmentSchema = z.object({
  TRUSTED_PROXY_IPS: z.string().default("").transform(parseTrustedProxyIps),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
  LOOPS_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  LOOPS_RESET_PASSWORD_TEMPLATE_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  LOOPS_VERIFY_EMAIL_TEMPLATE_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  LOOPS_INVITATION_TEMPLATE_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  POSTHOG_PROJECT_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  POSTHOG_HOST: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional(),
  ),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4301),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});
export function readEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.parse(env);
}
export type Environment = z.infer<typeof environmentSchema>;
