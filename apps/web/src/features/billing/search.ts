import { z } from "zod";
// Stripe sends people back here from Checkout with the outcome.
export const billingSearch = z.object({
  checkout: z.enum(["success", "cancelled"]).optional().catch(undefined),
});
