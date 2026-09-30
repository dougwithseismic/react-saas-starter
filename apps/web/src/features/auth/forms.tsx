import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Feedback, Panel } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { analytics } from "../../lib/analytics";
import { authClient, unwrap } from "../../lib/auth-client";
import { publishAuthChange } from "../../lib/auth-events";
export function AuthForm({
  mode,
}: {
  mode: "sign-in" | "sign-up" | "forgot-password" | "reset-password";
}) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [notice, setNotice] = useState("");
  const resetSearch = new URLSearchParams(window.location.search);
  const resetToken = resetSearch.get("token") ?? "";
  const invalidReset =
    mode === "reset-password" && (!resetToken || !!resetSearch.get("error"));
  const schema = z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      password: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (
        mode !== "reset-password" &&
        !z.email().safeParse(value.email).success
      )
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Enter a valid email address.",
        });
      if (mode !== "forgot-password" && (value.password?.length ?? 0) < 12)
        ctx.addIssue({
          code: "custom",
          path: ["password"],
          message: "Use at least 12 characters.",
        });
      if (
        mode === "sign-up" &&
        (!value.name?.trim() || value.name.length > 100)
      )
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "Enter a name of up to 100 characters.",
        });
    });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: async (data: z.infer<typeof schema>) => {
      const email = data.email ?? "",
        password = data.password ?? "";
      if (mode === "sign-up")
        return unwrap(
          await authClient.signUp.email({
            name: data.name ?? "",
            email,
            password,
          }),
        );
      if (mode === "sign-in")
        return unwrap(await authClient.signIn.email({ email, password }));
      if (mode === "forgot-password")
        return unwrap(
          await authClient.requestPasswordReset({
            email,
            redirectTo: `${window.location.origin}/reset-password`,
          }),
        );
      return unwrap(
        await authClient.resetPassword({
          newPassword: password,
          token: resetToken,
        }),
      );
    },
    onSuccess: async () => {
      analytics.track("auth_flow_completed", { action: mode });
      if (mode === "sign-in" || mode === "sign-up") {
        client.clear();
        publishAuthChange();
        const target = new URLSearchParams(window.location.search).get(
          "redirect",
        );
        const destination =
          target?.startsWith("/") &&
          !target.startsWith("//") &&
          !target.includes("\\")
            ? new URL(target, window.location.origin)
            : new URL("/account", window.location.origin);
        await navigate({
          to: destination.pathname,
          search: Object.fromEntries(destination.searchParams),
        });
      } else
        setNotice(
          mode === "forgot-password"
            ? "If this account exists, a reset email has been requested."
            : "Password reset. You can now sign in.",
        );
    },
  });
  const title = {
    "sign-in": "Welcome back",
    "sign-up": "Create your account",
    "forgot-password": "Reset your password",
    "reset-password": "Choose a new password",
  }[mode];
  return (
    <main id="main-content" className="auth-page">
      <Panel title={title}>
        <Feedback
          error={
            invalidReset
              ? "This reset link is invalid or expired. Request a new reset link."
              : mutation.error?.message
          }
          notice={notice}
        />
        {!invalidReset && (
          <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
            {Object.entries(errors).map(([field, error]) => (
              <p key={field} className="field-error" role="alert">
                {error.message}
              </p>
            ))}
            {mode === "sign-up" && (
              <label>
                Name
                <input
                  {...register("name")}
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </label>
            )}
            {mode !== "reset-password" && (
              <label>
                Email
                <input
                  {...register("email")}
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            {mode !== "forgot-password" && (
              <label>
                Password
                <input
                  {...register("password")}
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  minLength={12}
                  required
                />
              </label>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Working…"
                : {
                    "sign-in": "Sign in",
                    "sign-up": "Create account",
                    "forgot-password": "Send reset link",
                    "reset-password": "Save new password",
                  }[mode]}
            </Button>
          </form>
        )}
        <div className="auth-links">
          <Link
            to="/sign-in"
            search={{
              redirect:
                new URLSearchParams(window.location.search).get("redirect") ??
                undefined,
            }}
          >
            Sign in
          </Link>
          <Link
            to="/sign-up"
            search={{
              redirect:
                new URLSearchParams(window.location.search).get("redirect") ??
                undefined,
            }}
          >
            Create account
          </Link>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
      </Panel>
    </main>
  );
}
