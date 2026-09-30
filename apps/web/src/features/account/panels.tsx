import { Button, ConfirmAction, Panel } from "@repo/ui";
import { type FormEvent, useState } from "react";
import { authClient, type Session, unwrap } from "../../lib/auth-client";

type Props = {
  user: Session["user"];
  busy: boolean;
  run: (operation: () => Promise<unknown>) => void;
  onDeleted: () => void;
};
function form(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
export function ProfilePanel({ user, busy, run }: Props) {
  return (
    <Panel title="Profile">
      <form
        onSubmit={(event) => {
          const data = form(event);
          run(async () =>
            unwrap(
              await authClient.updateUser({
                name: String(data.get("name")),
              }),
            ),
          );
        }}
      >
        <label>
          Name
          <input
            name="name"
            defaultValue={user.name}
            required
            maxLength={100}
          />
        </label>
        <label>
          Email
          <input value={user.email} readOnly />
        </label>
        <Button type="submit" disabled={busy}>
          Save profile
        </Button>
      </form>
    </Panel>
  );
}
export function EmailPanel({ user, busy, run }: Props) {
  return (
    <Panel title="Email address">
      <p>
        {user.emailVerified
          ? "Your email is verified."
          : "Verify your email to accept organisation invitations."}
      </p>
      {!user.emailVerified && (
        <Button
          disabled={busy}
          onClick={() =>
            run(async () =>
              unwrap(
                await authClient.sendVerificationEmail({
                  email: user.email,
                  callbackURL: `${window.location.origin}/account`,
                }),
              ),
            )
          }
        >
          Send verification email
        </Button>
      )}
      <form
        onSubmit={(event) => {
          const data = form(event);
          run(async () =>
            unwrap(
              await authClient.changeEmail({
                newEmail: String(data.get("email")),
                callbackURL: `${window.location.origin}/account`,
              }),
            ),
          );
        }}
      >
        <label>
          New email
          <input type="email" name="email" required />
        </label>
        <Button type="submit" disabled={busy}>
          Request email change
        </Button>
      </form>
      <p className="helper">
        Email delivery requires a configured provider. Check your inbox to
        complete changes.
      </p>
    </Panel>
  );
}
export function PasswordPanel({ busy, run }: Props) {
  return (
    <Panel title="Change password">
      <form
        onSubmit={(event) => {
          const data = form(event);
          run(async () =>
            unwrap(
              await authClient.changePassword({
                currentPassword: String(data.get("current")),
                newPassword: String(data.get("password")),
                revokeOtherSessions: true,
              }),
            ),
          );
        }}
      >
        <label>
          Current password
          <input
            type="password"
            name="current"
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            name="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <p className="helper">
          At least 12 characters. Other devices will be signed out.
        </p>
        <Button type="submit" disabled={busy}>
          Change password
        </Button>
      </form>
    </Panel>
  );
}
export function DeletionPanel({ busy, run, onDeleted }: Props) {
  const [password, setPassword] = useState("");
  return (
    <Panel title="Delete account">
      <p>
        Permanently delete your account. Transfer ownership or leave
        organisations first.
      </p>
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          Confirm password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <ConfirmAction
          title="Delete your account?"
          description="This permanently removes your account and cannot be undone."
          disabled={busy || !password}
          onConfirm={() => {
            run(async () => {
              unwrap(await authClient.deleteUser({ password }));
              onDeleted();
            });
          }}
        >
          Delete account
        </ConfirmAction>
      </form>
    </Panel>
  );
}
