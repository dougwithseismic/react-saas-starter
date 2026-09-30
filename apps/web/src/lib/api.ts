import type { z } from "zod";
import { ApiError } from "./auth-client";
export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { message?: string; code?: string } };
    throw new ApiError(
      error.error?.message ?? "The request could not be completed",
      response.status,
      error.error?.code,
    );
  }
  return schema.parse(data);
}
