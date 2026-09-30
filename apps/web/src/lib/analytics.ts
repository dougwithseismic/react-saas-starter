import { analyticsPath, createClientAnalytics } from "./analytics-core";
export const analytics = createClientAnalytics();
const key = import.meta.env.VITE_POSTHOG_PROJECT_KEY;
if (key) {
  const ready = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host:
          import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        capture_performance: false,
        person_profiles: "identified_only",
        before_send: (event) => {
          if (!event) return null;
          // SDK super-properties also contain URLs: strip queries, hashes and invitation IDs.
          for (const properties of [
            event.properties,
            event.properties?.$set,
            event.properties?.$set_once,
          ]) {
            if (!properties || typeof properties !== "object") continue;
            for (const [name, value] of Object.entries(properties)) {
              if (
                /password|token|secret|email|authorization|cookie/i.test(name)
              )
                delete properties[name];
              else if (
                typeof value === "string" &&
                (name.includes("url") ||
                  name.includes("referrer") ||
                  name.includes("pathname"))
              ) {
                try {
                  const url = new URL(value);
                  properties[name] =
                    `${url.origin}${analyticsPath(url.pathname)}`;
                } catch {
                  properties[name] = analyticsPath(value);
                }
              }
            }
          }
          return event;
        },
      });
      return posthog;
    })
    .catch(() => null);
  analytics.use({
    name: "posthog",
    track: (event, properties) => {
      void ready
        .then((client) =>
          client?.capture(event, { ...properties, source: "client" }),
        )
        .catch(() => {});
    },
    identify: (userId) => {
      void ready.then((client) => client?.identify(userId)).catch(() => {});
    },
    reset: () => {
      void ready.then((client) => client?.reset()).catch(() => {});
    },
  });
}

export { analyticsPath } from "./analytics-core";
