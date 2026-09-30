import { queryOptions } from "@tanstack/react-query";
import { authClient, unwrap } from "../../lib/auth-client";
export const sessionKey = ["auth", "session"] as const;
export const sessionOptions = queryOptions({
  queryKey: sessionKey,
  queryFn: async ({ signal }) =>
    unwrap(await authClient.getSession({ fetchOptions: { signal } })),
  staleTime: 0,
  retry: false,
});
