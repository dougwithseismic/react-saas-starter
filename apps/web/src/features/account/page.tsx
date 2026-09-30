import { Button, Feedback, Panel } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loading, QueryError } from "../../components/query-state";
import { analytics } from "../../lib/analytics";
import { authClient, unwrap } from "../../lib/auth-client";
import { publishAuthChange } from "../../lib/auth-events";
import { sessionOptions } from "../auth/queries";
import {
  DeletionPanel,
  EmailPanel,
  PasswordPanel,
  ProfilePanel,
} from "./panels";
export default function AccountPage() {
  const client = useQueryClient(),
    session = useQuery(sessionOptions),
    [notice, setNotice] = useState("");
  const sessions = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: async ({ signal }) =>
      unwrap(await authClient.listSessions({ fetchOptions: { signal } })),
  });
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      analytics.track("account_action_completed");
      publishAuthChange();
      await client.invalidateQueries();
      setNotice("Changes saved.");
    },
  });
  const user = session.data?.user;
  if (!user) return <Loading />;
  function run(operation: () => Promise<unknown>) {
    setNotice("");
    mutation.mutate(operation);
  }
  return (
    <main id="main-content" className="page">
      <div className="page-title">
        <h1>Your account</h1>
        <p>Your details, security, and signed-in devices.</p>
      </div>
      <Feedback error={mutation.error?.message} notice={notice} />
      <div className="grid">
        <ProfilePanel
          user={user}
          busy={mutation.isPending}
          run={run}
          onDeleted={() => {
            analytics.reset();
            client.clear();
            window.location.assign("/sign-in");
          }}
        />
        <EmailPanel
          user={user}
          busy={mutation.isPending}
          run={run}
          onDeleted={() => {
            analytics.reset();
            client.clear();
            window.location.assign("/sign-in");
          }}
        />
        <PasswordPanel
          user={user}
          busy={mutation.isPending}
          run={run}
          onDeleted={() => {
            analytics.reset();
            client.clear();
            window.location.assign("/sign-in");
          }}
        />
        <DeletionPanel
          user={user}
          busy={mutation.isPending}
          run={run}
          onDeleted={() => {
            analytics.reset();
            client.clear();
            window.location.assign("/sign-in");
          }}
        />
        <section className="wide">
          <Panel title="Signed-in devices">
            {sessions.isPending ? (
              <Loading />
            ) : sessions.error ? (
              <QueryError
                error={sessions.error}
                retry={() => void sessions.refetch()}
              />
            ) : (
              sessions.data?.map((item) => (
                <div className="row" key={item.id}>
                  <div>
                    <b>{item.userAgent ?? "Unknown device"}</b>
                    <p>
                      Expires {new Date(item.expiresAt).toLocaleString()}
                      {session.data?.session.id === item.id
                        ? " · Current session"
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={mutation.isPending}
                    onClick={() =>
                      run(async () => {
                        unwrap(
                          await authClient.revokeSession({ token: item.token }),
                        );
                        if (item.id === session.data?.session.id) {
                          analytics.reset();
                          client.clear();
                          window.location.assign("/sign-in");
                        }
                      })
                    }
                  >
                    Revoke session
                  </Button>
                </div>
              ))
            )}
          </Panel>
        </section>
      </div>
    </main>
  );
}
