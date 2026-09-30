import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./auth-client";

function handleUnauthorized(error: unknown) {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/sign-")
  ) {
    window.location.assign(
      `/sign-in?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  }
}
export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleUnauthorized }),
    mutationCache: new MutationCache({ onError: handleUnauthorized }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
export const queryClient = createQueryClient();
