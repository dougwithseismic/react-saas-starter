import type { z } from "zod";
import { ApiError } from "./auth-client";

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...init.headers },
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
export function api<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  return request(path, schema, { signal });
}
export function post<T extends z.ZodType>(
  path: string,
  schema: T,
  body: unknown = {},
): Promise<z.infer<T>> {
  return request(path, schema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
