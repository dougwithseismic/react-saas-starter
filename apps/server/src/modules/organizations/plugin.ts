import { type Database, eq, schema } from "@repo/db";
import { organization } from "better-auth/plugins";
import type { Environment } from "../../config/env.js";
import { type AnalyticsSink, noopAnalytics } from "../analytics/analytics.js";
import type { createEmailSender } from "../auth/email.js";

export function createOrganizationPlugin(
  db: Database,
  env: Environment,
  sendEmail: ReturnType<typeof createEmailSender>,
  analytics: AnalyticsSink = noopAnalytics,
) {
  return organization({
    // Delete the parent first so PostgreSQL cascades can distinguish an
    // authorised organisation deletion from removing its final owner.
    organizationHooks: {
      afterCreateOrganization: async ({ organization, user }) => {
        analytics.capture("organization.created", user.id, {
          organizationId: organization.id,
        });
      },
      afterUpdateOrganization: async ({ organization, user }) => {
        if (organization)
          analytics.capture("organization.updated", user.id, {
            organizationId: organization.id,
          });
      },
      afterDeleteOrganization: async ({ organization, user }) => {
        analytics.capture("organization.deleted", user.id, {
          organizationId: organization.id,
        });
      },
      afterAddMember: async ({ member, user }) => {
        analytics.capture("organization.member_added", user.id, {
          organizationId: member.organizationId,
          role: member.role,
        });
      },
      afterRemoveMember: async ({ member, user }) => {
        analytics.capture("organization.member_removed", user.id, {
          organizationId: member.organizationId,
        });
      },
      afterUpdateMemberRole: async ({ member, user }) => {
        analytics.capture("organization.member_role_updated", user.id, {
          organizationId: member.organizationId,
          role: member.role,
        });
      },
      afterCreateInvitation: async ({ invitation, inviter }) => {
        analytics.capture("organization.invitation_created", inviter.userId, {
          organizationId: invitation.organizationId,
        });
      },
      afterAcceptInvitation: async ({ invitation, user }) => {
        analytics.capture("organization.invitation_accepted", user.id, {
          organizationId: invitation.organizationId,
        });
      },
      afterCancelInvitation: async ({ invitation, cancelledBy }) => {
        analytics.capture("organization.invitation_cancelled", cancelledBy.id, {
          organizationId: invitation.organizationId,
        });
      },
      afterRejectInvitation: async ({ invitation, user }) => {
        analytics.capture("organization.invitation_rejected", user.id, {
          organizationId: invitation.organizationId,
        });
      },
      beforeDeleteOrganization: async ({ organization: org }) => {
        await db
          .delete(schema.organization)
          .where(eq(schema.organization.id, org.id));
      },
    },
    requireEmailVerificationOnInvitation: true,
    sendInvitationEmail:
      env.LOOPS_API_KEY && env.LOOPS_INVITATION_TEMPLATE_ID
        ? async (data) =>
            sendEmail({
              kind: "invitation",
              email: data.email,
              url: `${env.APP_ORIGIN}/invitations/${data.id}`,
              name: data.inviter.user.name,
              organizationName: data.organization.name,
            })
        : undefined,
  });
}
