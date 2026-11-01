import { billingSummarySchema, invoiceListSchema } from "@repo/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const billingPath = (organisationId: string) =>
  `/api/organizations/${encodeURIComponent(organisationId)}/billing`;
export const billingKey = (organisationId: string) =>
  ["billing", organisationId] as const;
export const billingOptions = (organisationId: string) =>
  queryOptions({
    queryKey: billingKey(organisationId),
    queryFn: ({ signal }) =>
      api(billingPath(organisationId), billingSummarySchema, signal),
    enabled: !!organisationId,
  });
export const invoicesOptions = (organisationId: string) =>
  queryOptions({
    queryKey: [...billingKey(organisationId), "invoices"] as const,
    queryFn: async ({ signal }) =>
      (
        await api(
          `${billingPath(organisationId)}/invoices`,
          invoiceListSchema,
          signal,
        )
      ).invoices,
  });
