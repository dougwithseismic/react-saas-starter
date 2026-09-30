import pino from "pino";
import type { Environment } from "../config/env.js";
export function createLogger(env: Environment) {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "api" },
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[redacted]",
    },
  });
}
export type Logger = ReturnType<typeof createLogger>;
