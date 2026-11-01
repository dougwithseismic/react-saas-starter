import type { BillingSummary } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { sessionOptions } from "../auth/queries";
import { paymentProblem } from "./copy";
import { billingOptions } from "./queries";

// Tells owners and admins of the active organisation that a payment failed,
// on every page except billing, which says it in place.
export function PaymentBanner() {
  const session = useQuery(sessionOptions);
  const onBilling = useRouterState({
    select: (state) => state.location.pathname.endsWith("/billing"),
  });
  const summary = useQuery({
    ...billingOptions(session.data?.session.activeOrganizationId ?? ""),
    retry: false,
  });
  if (onBilling || !summary.data) return null;
  return <PaymentAlert summary={summary.data} />;
}

export function PaymentAlert({ summary }: { summary: BillingSummary }) {
  if (!summary.canManage || !summary.paymentFailed) return null;
  return (
    <div className="billing-banner" role="alert">
      <p>{paymentProblem(summary)}</p>
      <Link
        to="/organisations/$organisationId/billing"
        params={{ organisationId: summary.organization.id }}
      >
        Go to billing
      </Link>
    </div>
  );
}
