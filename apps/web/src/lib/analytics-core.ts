export type EventProperties = Record<string, string | number | boolean | null>;
export interface ClientAnalyticsPlugin {
  name: string;
  track(event: string, properties: EventProperties): void;
  identify?(userId: string): void;
  reset?(): void;
}
// Account analytics accepts scalar properties only; credentials never belong here.
export function sanitizeProperties(
  properties: EventProperties,
): EventProperties {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        !/password|token|secret|email|authorization|cookie/i.test(key) &&
        (value === null ||
          ["string", "number", "boolean"].includes(typeof value)),
    ),
  );
}
export function analyticsPath(path: string) {
  return (
    path
      .split(/[?#]/)[0]
      ?.replace(/\/invitations\/[^/]+/, "/invitations/:id") ?? "/"
  );
}
export function createClientAnalytics(plugins: ClientAnalyticsPlugin[] = []) {
  let identity: string | null = null;
  function each(callback: (plugin: ClientAnalyticsPlugin) => void) {
    for (const plugin of plugins) {
      try {
        callback(plugin);
      } catch {
        /* Analytics never blocks an account action. */
      }
    }
  }
  return {
    use(plugin: ClientAnalyticsPlugin) {
      plugins.push(plugin);
      if (identity) {
        try {
          plugin.identify?.(identity);
        } catch {}
      }
    },
    track(event: string, properties: EventProperties = {}) {
      each((plugin) => plugin.track(event, sanitizeProperties(properties)));
    },
    identify(userId: string | null) {
      if (userId === identity) return;
      if (identity !== null || userId === null)
        each((plugin) => plugin.reset?.());
      identity = userId;
      if (userId) each((plugin) => plugin.identify?.(userId));
    },
    reset() {
      identity = null;
      each((plugin) => plugin.reset?.());
    },
  };
}
