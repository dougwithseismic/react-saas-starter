import {
  type BillingSummary,
  billingRedirectSchema,
  entitlementsFor,
  type Invoice,
  isOpen,
  type PaidPlanId,
  paidPlanIdSchema,
  planIds,
  plans,
} from "@repo/contracts";
import { Button, Feedback, Panel } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loading, QueryError } from "../../components/query-state";
import { analytics } from "../../lib/analytics";
import { post } from "../../lib/api";
import {
  entitlementLines,
  formatDate,
  formatMoney,
  invoiceStatus,
  paymentProblem,
  subscriptionStatus,
} from "./copy";
import { billingOptions, billingPath, invoicesOptions } from "./queries";
import { billingSearch } from "./search";

// How long to keep asking after Checkout, while Stripe's webhook arrives.
const confirmWindow = 60_000;

export default function BillingPage() {
  const { organisationId = "" } = useParams({ strict: false });
  const { checkout } = billingSearch.parse(useSearch({ strict: false }));
  const [confirming, setConfirming] = useState(checkout === "success");
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), confirmWindow);
    return () => clearTimeout(timer);
  }, [confirming]);
  const summary = useQuery({
    ...billingOptions(organisationId),
    refetchInterval: (query) =>
      confirming && query.state.data?.plan === "free" ? 2_000 : false,
  });
  const data = summary.data;
  const invoices = useQuery({
    ...invoicesOptions(organisationId),
    enabled: !!data?.enabled && data.canManage && data.hasBillingAccount,
  });
  const redirect = ({ url }: { url: string }) => window.location.assign(url);
  const startCheckout = useMutation({
    mutationFn: (plan: PaidPlanId) =>
      post(`${billingPath(organisationId)}/checkout`, billingRedirectSchema, {
        plan,
      }),
    onSuccess: redirect,
  });
  const openPortal = useMutation({
    mutationFn: () =>
      post(`${billingPath(organisationId)}/portal`, billingRedirectSchema),
    onSuccess: redirect,
  });
  const viewed = useRef(false);
  useEffect(() => {
    if (!data || viewed.current) return;
    viewed.current = true;
    analytics.track("billing_plans_viewed", { plan: data.plan });
  }, [data]);
  const busy =
    startCheckout.isPending ||
    startCheckout.isSuccess ||
    openPortal.isPending ||
    openPortal.isSuccess;
  return (
    <main id="main-content" className="page">
      <div className="page-title">
        <h1>Billing</h1>
        <p>
          {data
            ? `The plan, payments and invoices for ${data.organization.name}.`
            : "The plan, payments and invoices for this organisation."}
        </p>
        <Link to="/organisations" search={{ organisationId }}>
          Back to the organisation
        </Link>
      </div>
      {checkout === "cancelled" && (
        <p className="feedback" role="status">
          Checkout was cancelled. Nothing was charged.
        </p>
      )}
      {checkout === "success" && data && (
        <p className="feedback success" role="status">
          {data.plan !== "free"
            ? `Thank you. ${data.organization.name} is on ${plans[data.plan].name}.`
            : confirming
              ? "Thank you. Confirming the payment, which takes a few seconds."
              : "The payment hasn't been confirmed yet. Refresh this page in a minute."}
        </p>
      )}
      <Feedback
        error={startCheckout.error?.message ?? openPortal.error?.message}
      />
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <QueryError
          error={summary.error}
          retry={() => void summary.refetch()}
        />
      ) : (
        data && (
          <BillingDetails
            summary={data}
            invoices={{
              data: invoices.data,
              error: invoices.error,
              retry: () => void invoices.refetch(),
            }}
            busy={busy}
            onCheckout={(plan) => startCheckout.mutate(plan)}
            onPortal={() => openPortal.mutate()}
          />
        )
      )}
    </main>
  );
}

export function BillingDetails({
  summary,
  invoices,
  busy = false,
  onCheckout,
  onPortal,
}: {
  summary: BillingSummary;
  invoices: { data?: Invoice[]; error?: Error | null; retry: () => void };
  busy?: boolean;
  onCheckout: (plan: PaidPlanId) => void;
  onPortal: () => void;
}) {
  const { plan, subscription, canManage, enabled } = summary;
  const open = subscription !== null && isOpen(subscription.status);
  const portal = enabled && canManage && summary.hasBillingAccount;
  return (
    <div className="grid">
      {!enabled && (
        <p className="feedback wide" role="status">
          Billing is switched off because the server has no Stripe keys. Plans
          can't be bought or changed until they are set.
        </p>
      )}
      {canManage && summary.paymentFailed && (
        <div className="feedback error wide billing-alert" role="alert">
          <p>{paymentProblem(summary)}</p>
          {portal && (
            <div className="actions">
              <Button disabled={busy} onClick={onPortal}>
                Update payment method
              </Button>
            </div>
          )}
        </div>
      )}
      <Panel title="Current plan">
        <div>
          <p className="plan-name">{plans[plan].name}</p>
          <p>{subscriptionStatus(summary)}</p>
        </div>
        <ul className="plan-features">
          {entitlementLines(summary.entitlements).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {!canManage ? (
          <p className="helper">Only owners and admins can change the plan.</p>
        ) : (
          portal && (
            <div className="actions">
              <Button variant="secondary" disabled={busy} onClick={onPortal}>
                Manage billing
              </Button>
              <p className="helper">
                Change the card, plan or billing details, or cancel.
              </p>
            </div>
          )
        )}
      </Panel>
      {canManage && (
        <Panel title="Invoices">
          {!enabled ? (
            <p>Invoices show here while billing is switched on.</p>
          ) : !summary.hasBillingAccount ? (
            <p>No invoices yet.</p>
          ) : invoices.error ? (
            <QueryError error={invoices.error} retry={invoices.retry} />
          ) : !invoices.data ? (
            <Loading />
          ) : invoices.data.length === 0 ? (
            <p>No invoices yet.</p>
          ) : (
            <div>
              {invoices.data.map((invoice) => (
                <div className="row" key={invoice.id}>
                  <div>
                    <b>{formatMoney(invoice.total, invoice.currency)}</b>
                    <p>
                      {[
                        formatDate(invoice.createdAt),
                        invoice.number,
                        invoiceStatus(invoice.status),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {invoice.hostedInvoiceUrl && (
                    <a
                      className="button secondary"
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      <section className="wide">
        <Panel title="Plans">
          {canManage && enabled && open && (
            <p className="helper">
              To switch plans, use Manage billing. Changes are prorated.
            </p>
          )}
          <div className="plan-grid">
            {planIds.map((id) => {
              const item = plans[id];
              const paid = paidPlanIdSchema.safeParse(id).data;
              const action =
                canManage && enabled && !open && paid && id !== plan ? (
                  summary.purchasable.includes(paid) ? (
                    <Button disabled={busy} onClick={() => onCheckout(paid)}>
                      {summary.trialAvailable && item.trialDays > 0
                        ? `Try ${item.name} free for ${item.trialDays} days`
                        : `Choose ${item.name}`}
                    </Button>
                  ) : (
                    <p className="helper">Not available yet.</p>
                  )
                ) : null;
              return (
                <article
                  key={id}
                  className="plan-card"
                  aria-label={item.name}
                  aria-current={id === plan || undefined}
                >
                  <h3>{item.name}</h3>
                  <p className="plan-price">{item.price}</p>
                  <p>{item.description}</p>
                  <ul className="plan-features">
                    {entitlementLines(entitlementsFor(id)).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {id === plan ? (
                    <p className="plan-badge">Current plan</p>
                  ) : (
                    action
                  )}
                </article>
              );
            })}
          </div>
        </Panel>
      </section>
    </div>
  );
}
