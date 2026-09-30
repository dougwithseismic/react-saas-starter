import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
});
export const accountResponseSchema = z.object({ user: userSchema });
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "ready", "unavailable"]),
});
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export const profileInputSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
});
export const organizationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase words separated by hyphens",
    ),
});
export type User = z.infer<typeof userSchema>;
