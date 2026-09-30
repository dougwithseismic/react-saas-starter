import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [organizationClient()],
});
export type Session = typeof authClient.$Infer.Session;
type Result<T> =
  | { data: T; error: null }
  | { data: null; error: { message?: string; status?: number; code?: string } };
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function unwrap<T>(result: Result<T>): T {
  if (result.error)
    throw new ApiError(
      result.error.message ?? "The request could not be completed",
      result.error.status ?? 500,
      result.error.code,
    );
  return result.data;
}
