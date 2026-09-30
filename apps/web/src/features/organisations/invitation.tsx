import { Button, Feedback, Panel } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Loading, QueryError } from "../../components/query-state";
import { authClient, unwrap } from "../../lib/auth-client";
import { sessionOptions } from "../auth/queries";
export default function InvitationPage() {
  const params = useParams({ strict: false }),
    id = params.invitationId ?? "",
    client = useQueryClient(),
    session = useQuery(sessionOptions);
  const invitation = useQuery({
    queryKey: ["invitation", id],
    queryFn: async ({ signal }) =>
      unwrap(
        await authClient.organization.getInvitation({
          query: { id },
          fetchOptions: { signal },
        }),
      ),
    enabled: !!id && !!session.data?.user.emailVerified,
  });
  const mutation = useMutation({
    mutationFn: async (accept: boolean) => {
      if (accept)
        return unwrap(
          await authClient.organization.acceptInvitation({ invitationId: id }),
        );
      return unwrap(
        await authClient.organization.rejectInvitation({ invitationId: id }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const user = session.data?.user;
  return (
    <main id="main-content" className="page">
      <div className="page-title">
        <h1>Organisation invitation</h1>
      </div>
      <Panel title="Join your people">
        <Feedback
          error={mutation.error?.message}
          notice={mutation.isSuccess ? "Invitation updated." : undefined}
        />
        {!user?.emailVerified ? (
          <p>
            Verify your email in <Link to="/account">account settings</Link>,
            then return to this invitation.
          </p>
        ) : invitation.isPending ? (
          <Loading />
        ) : invitation.error ? (
          <QueryError
            error={invitation.error}
            retry={() => void invitation.refetch()}
          />
        ) : invitation.data ? (
          <>
            <h2>{invitation.data.organizationName}</h2>
            <p>
              Invited as {invitation.data.role} · {invitation.data.email}
            </p>
            <p>Status: {invitation.data.status}</p>
            {invitation.data.status === "pending" && !mutation.isSuccess && (
              <div className="actions">
                <Button
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(true)}
                >
                  Accept invitation
                </Button>
                <Button
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(false)}
                >
                  Decline invitation
                </Button>
              </div>
            )}
            <Link to="/organisations">View organisations</Link>
          </>
        ) : (
          <p>This invitation is no longer available.</p>
        )}
      </Panel>
    </main>
  );
}
