import { Button, ConfirmAction, Feedback, Panel } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Loading, QueryError } from "../../components/query-state";
import { analytics } from "../../lib/analytics";
import { authClient, unwrap } from "../../lib/auth-client";
import { sessionOptions } from "../auth/queries";
import { organisationSearch } from "./search";
export default function OrganisationsPage() {
  const client = useQueryClient(),
    session = useQuery(sessionOptions),
    navigate = useNavigate(),
    [notice, setNotice] = useState("");
  const search = organisationSearch.parse(useSearch({ strict: false }));
  const active =
    search.organisationId ?? session.data?.session.activeOrganizationId ?? "";
  const setSelected = (id: string) =>
    navigate({ to: "/organisations", search: { organisationId: id } });
  const orgs = useQuery({
    queryKey: ["organisations"],
    queryFn: async ({ signal }) =>
      unwrap(await authClient.organization.list({ fetchOptions: { signal } })),
  });
  const detail = useQuery({
    queryKey: ["organisation", active],
    queryFn: async ({ signal }) =>
      unwrap(
        await authClient.organization.getFullOrganization({
          query: { organizationId: active },
          fetchOptions: { signal },
        }),
      ),
    enabled: !!active && !!orgs.data?.some((org) => org.id === active),
  });
  const incoming = useQuery({
    queryKey: ["invitations", "incoming"],
    queryFn: async ({ signal }) =>
      unwrap(
        await authClient.organization.listUserInvitations({
          fetchOptions: { signal },
        }),
      ),
    enabled: !!session.data?.user.emailVerified,
  });
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      analytics.track("organisation_action_completed");
      await client.invalidateQueries();
      setNotice("Changes saved.");
    },
  });
  function run(operation: () => Promise<unknown>) {
    setNotice("");
    mutation.mutate(operation);
  }
  function form(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return new FormData(event.currentTarget);
  }
  const org = detail.data,
    role = org?.members.find(
      (member) => member.user.id === session.data?.user.id,
    )?.role,
    manager = role === "owner" || role === "admin";
  const invitationId = new URLSearchParams(window.location.search).get(
    "invitation",
  );
  return (
    <main id="main-content" className="page">
      <div className="page-title">
        <h1>Organisations</h1>
        <p>Your people and their access, in one place.</p>
      </div>
      <Feedback error={mutation.error?.message} notice={notice} />
      {invitationId && (
        <p className="feedback">
          You followed an invitation. Verify your email, then accept the
          matching invitation below.
        </p>
      )}
      <div className="grid">
        <Panel title="Your organisations">
          {orgs.isPending ? (
            <Loading />
          ) : orgs.error ? (
            <QueryError error={orgs.error} retry={() => void orgs.refetch()} />
          ) : (
            <label>
              Organisation
              <select
                value={active}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const id = event.target.value;
                  run(async () => {
                    unwrap(
                      await authClient.organization.setActive({
                        organizationId: id || null,
                      }),
                    );
                    await setSelected(id);
                  });
                }}
              >
                <option value="">Choose an organisation</option>
                {orgs.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {orgs.data?.length === 0 && (
            <p>Create an organisation or accept an invitation to begin.</p>
          )}
          <form
            onSubmit={(event) => {
              const data = form(event);
              run(async () => {
                const created = unwrap(
                  await authClient.organization.create({
                    name: String(data.get("name")),
                    slug: String(data.get("slug")),
                  }),
                );
                if (created) await setSelected(created.id);
              });
            }}
          >
            <label>
              Name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="your-organisation"
              />
            </label>
            <Button type="submit" disabled={mutation.isPending}>
              Create organisation
            </Button>
          </form>
        </Panel>
        <Panel title="Your invitations">
          {!session.data?.user.emailVerified ? (
            <p>
              Verify your email in <Link to="/account">account settings</Link>{" "}
              to view and accept invitations.
            </p>
          ) : incoming.isPending ? (
            <Loading />
          ) : incoming.error ? (
            <QueryError
              error={incoming.error}
              retry={() => void incoming.refetch()}
            />
          ) : (
            <>
              {incoming.data?.filter((item) => item.status === "pending")
                .length === 0 && <p>No pending invitations.</p>}
              {incoming.data
                ?.filter((item) => item.status === "pending")
                .map((item) => (
                  <div className="row" key={item.id}>
                    <div>
                      <b>{item.email}</b>
                      <p>Role: {item.role}</p>
                    </div>
                    <div className="actions">
                      <Button
                        disabled={mutation.isPending}
                        onClick={() =>
                          run(async () =>
                            unwrap(
                              await authClient.organization.acceptInvitation({
                                invitationId: item.id,
                              }),
                            ),
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={mutation.isPending}
                        onClick={() =>
                          run(async () =>
                            unwrap(
                              await authClient.organization.rejectInvitation({
                                invitationId: item.id,
                              }),
                            ),
                          )
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
            </>
          )}
        </Panel>
        {detail.isLoading && active && <Loading />}
        {active &&
          orgs.isSuccess &&
          !orgs.data?.some((item) => item.id === active) && (
            <p role="alert" className="feedback error">
              This organisation is unavailable or you no longer have access.
            </p>
          )}
        {detail.error && (
          <QueryError
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        )}
        {org && (
          <>
            <Panel title={org.name}>
              {manager && (
                <form
                  key={org.id}
                  onSubmit={(event) => {
                    const data = form(event);
                    run(async () =>
                      unwrap(
                        await authClient.organization.update({
                          organizationId: org.id,
                          data: {
                            name: String(data.get("name")),
                            slug: String(data.get("slug")),
                          },
                        }),
                      ),
                    );
                  }}
                >
                  <label>
                    Name
                    <input name="name" defaultValue={org.name} required />
                  </label>
                  <label>
                    Slug
                    <input
                      name="slug"
                      defaultValue={org.slug}
                      required
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    />
                  </label>
                  <Button type="submit" disabled={mutation.isPending}>
                    Save organisation
                  </Button>
                </form>
              )}
              <div className="actions">
                <ConfirmAction
                  title="Leave organisation?"
                  description="You will lose access. Owners must leave another owner in place."
                  disabled={mutation.isPending}
                  onConfirm={() =>
                    run(async () => {
                      unwrap(
                        await authClient.organization.leave({
                          organizationId: org.id,
                        }),
                      );
                      await setSelected("");
                    })
                  }
                >
                  Leave
                </ConfirmAction>
                {role === "owner" && (
                  <ConfirmAction
                    title="Delete organisation?"
                    description="This permanently removes the organisation and cannot be undone."
                    disabled={mutation.isPending}
                    onConfirm={() =>
                      run(async () => {
                        unwrap(
                          await authClient.organization.delete({
                            organizationId: org.id,
                          }),
                        );
                        await setSelected("");
                      })
                    }
                  >
                    Delete organisation
                  </ConfirmAction>
                )}
              </div>
            </Panel>
            <Panel title="Invite someone">
              {manager ? (
                <form
                  onSubmit={(event) => {
                    const data = form(event);
                    run(async () =>
                      unwrap(
                        await authClient.organization.inviteMember({
                          organizationId: org.id,
                          email: String(data.get("email")),
                          role: String(data.get("role")) as "member" | "admin",
                        }),
                      ),
                    );
                  }}
                >
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={mutation.isPending}>
                    Create invitation
                  </Button>
                  <p className="helper">
                    Share the invitation link below. Email is also sent when a
                    delivery provider is configured.
                  </p>
                </form>
              ) : (
                <p>Owners and admins can invite members.</p>
              )}
            </Panel>
            <section className="wide">
              <Panel title="Members">
                {org.members.map((member) => (
                  <div className="row" key={member.id}>
                    <div>
                      <b>{member.user.name}</b>
                      <p>{member.user.email}</p>
                    </div>
                    {manager ? (
                      <div className="actions">
                        <select
                          aria-label={`Role for ${member.user.name}`}
                          value={member.role}
                          disabled={
                            mutation.isPending ||
                            (member.role === "owner" && role !== "owner")
                          }
                          onChange={(event) =>
                            run(async () =>
                              unwrap(
                                await authClient.organization.updateMemberRole({
                                  organizationId: org.id,
                                  memberId: member.id,
                                  role: event.target.value as
                                    | "member"
                                    | "admin"
                                    | "owner",
                                }),
                              ),
                            )
                          }
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          {(role === "owner" || member.role === "owner") && (
                            <option value="owner">Owner</option>
                          )}
                        </select>
                        <ConfirmAction
                          title={`Remove ${member.user.name}?`}
                          description="This member will lose access to the organisation."
                          disabled={mutation.isPending}
                          onConfirm={() =>
                            run(async () => {
                              unwrap(
                                await authClient.organization.removeMember({
                                  organizationId: org.id,
                                  memberIdOrEmail: member.id,
                                }),
                              );
                              if (member.user.id === session.data?.user.id)
                                await setSelected("");
                            })
                          }
                        >
                          Remove
                        </ConfirmAction>
                      </div>
                    ) : (
                      <span>{member.role}</span>
                    )}
                  </div>
                ))}
              </Panel>
            </section>
            <section className="wide">
              <Panel title="Organisation invitations">
                {org.invitations.length === 0 && <p>No invitations yet.</p>}
                {org.invitations.map((item) => (
                  <div className="row" key={item.id}>
                    <div>
                      <b>{item.email}</b>
                      <p>
                        {item.role} · {item.status}
                      </p>
                    </div>
                    {manager && item.status === "pending" && (
                      <div className="actions">
                        <Button
                          variant="secondary"
                          disabled={mutation.isPending}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(
                                `${window.location.origin}/invitations/${item.id}`,
                              )
                              .then(() => setNotice("Invitation link copied."))
                              .catch(() =>
                                setNotice(
                                  `Invitation link: ${window.location.origin}/invitations/${item.id}`,
                                ),
                              );
                          }}
                        >
                          Copy invitation link
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={mutation.isPending}
                          onClick={() =>
                            run(async () =>
                              unwrap(
                                await authClient.organization.cancelInvitation({
                                  invitationId: item.id,
                                }),
                              ),
                            )
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </Panel>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
