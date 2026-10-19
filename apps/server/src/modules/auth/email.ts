import { APIError } from "better-auth/api";
import type { Environment } from "../../config/env.js";
export type TransactionalEmail = {
  kind: "resetPassword" | "verifyEmail" | "invitation";
  email: string;
  url: string;
  name: string;
  organizationName?: string;
};
const emailSettings = [
  "LOOPS_API_KEY",
  "LOOPS_RESET_PASSWORD_TEMPLATE_ID",
  "LOOPS_VERIFY_EMAIL_TEMPLATE_ID",
  "LOOPS_INVITATION_TEMPLATE_ID",
] as const;
export function missingEmailSettings(env: Environment) {
  return emailSettings.filter((name) => !env[name]);
}
export function createEmailSender(
  env: Environment,
  transport: typeof fetch = fetch,
) {
  const templates = {
    resetPassword: env.LOOPS_RESET_PASSWORD_TEMPLATE_ID,
    verifyEmail: env.LOOPS_VERIFY_EMAIL_TEMPLATE_ID,
    invitation: env.LOOPS_INVITATION_TEMPLATE_ID,
  };
  return async (message: TransactionalEmail) => {
    const transactionalId = templates[message.kind];
    if (!env.LOOPS_API_KEY || !transactionalId)
      throw new APIError("SERVICE_UNAVAILABLE", {
        message:
          "Email delivery is not configured. Contact your administrator.",
      });
    try {
      const response = await transport(
        "https://app.loops.so/api/v1/transactional",
        {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            authorization: `Bearer ${env.LOOPS_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            transactionalId,
            email: message.email,
            addToAudience: false,
            dataVariables: {
              url: message.url,
              name: message.name,
              ...(message.organizationName
                ? { organizationName: message.organizationName }
                : {}),
            },
          }),
        },
      );
      if (!response.ok) throw new Error("Email provider rejected request");
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("success" in result) ||
        result.success !== true
      )
        throw new Error("Email provider rejected request");
    } catch {
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Email delivery failed. Please try again later.",
      });
    }
  };
}
