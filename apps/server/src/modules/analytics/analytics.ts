import { PostHog } from "posthog-node";
import type { Environment } from "../../config/env.js";
import type { Logger } from "../../lib/logger.js";
export type AnalyticsEvent =
  | "account.created"
  | "account.deleted"
  | "account.updated"
  | "session.created"
  | "session.deleted"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organization.member_added"
  | "organization.member_removed"
  | "organization.member_role_updated"
  | "organization.invitation_created"
  | "organization.invitation_accepted"
  | "organization.invitation_cancelled"
  | "organization.invitation_rejected";
export type AnalyticsProperties = { organizationId?: string; role?: string };
export interface AnalyticsSink {
  capture(
    event: AnalyticsEvent,
    userId: string,
    properties?: AnalyticsProperties,
  ): void;
  identify(userId: string): void;
  shutdown(): Promise<void>;
}
export const noopAnalytics: AnalyticsSink = {
  capture() {},
  identify() {},
  async shutdown() {},
};
export function createAnalytics(
  env: Environment,
  logger: Logger,
): AnalyticsSink {
  if (!env.POSTHOG_PROJECT_KEY) return noopAnalytics;
  const client = new PostHog(env.POSTHOG_PROJECT_KEY, {
    host: env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    requestTimeout: 10_000,
    disableGeoip: true,
  });
  client.on("error", () =>
    logger.warn({ provider: "posthog" }, "Analytics delivery failed"),
  );
  return protectAnalytics(
    {
      capture: (event, distinctId, properties) =>
        client.capture({ event, distinctId, properties }),
      identify: (distinctId) => client.identify({ distinctId }),
      shutdown: () => client.shutdown(5000),
    },
    logger,
  );
}
export function protectAnalytics(
  sink: AnalyticsSink,
  logger: Pick<Logger, "warn">,
): AnalyticsSink {
  const report = () =>
    logger.warn({ provider: "analytics" }, "Analytics delivery failed");
  return {
    capture(event, userId, properties) {
      try {
        const safeProperties: AnalyticsProperties = {};
        if (typeof properties?.organizationId === "string")
          safeProperties.organizationId = properties.organizationId;
        if (typeof properties?.role === "string")
          safeProperties.role = properties.role;
        sink.capture(
          event,
          userId,
          properties === undefined ? undefined : safeProperties,
        );
      } catch {
        report();
      }
    },
    identify(userId) {
      try {
        sink.identify(userId);
      } catch {
        report();
      }
    },
    async shutdown() {
      try {
        await sink.shutdown();
      } catch {
        report();
      }
    },
  };
}
