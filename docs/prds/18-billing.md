# PRD 18: starter, Stripe billing per organisation

## Goal

An app made from the starter can take money from day one. A product that sells nothing gets
no signal about what people value, so payments belong in the starter, not in a later
rewrite. The starter has accounts, organisations, analytics and email, but no way to pay. A stranger should be able to pick a plan, pay through
Stripe Checkout, manage it in the Customer Portal, and have the app know what they're entitled
to.

## Locked decisions

- Subscriptions belong to an organisation, not a user. The owner and admins manage billing.
- Use Better Auth's Stripe plugin if it covers organisation subscriptions, trials and the
  Customer Portal (check its current docs first); otherwise a `billing` module in
  `apps/server/src/modules` with our own webhook. Record which, and why, in the starter's
  decisions.
- Plans come from configuration that names Stripe price ids, with entitlements per plan (seats,
  limits, features) in shared code (`packages/contracts`), so the web app and the API read the
  same rules.
- The webhook handles checkout completed, subscription created, updated and deleted, invoice
  paid and payment failed. It verifies signatures, is idempotent per event id, and keeps a
  `subscriptions` table that mirrors Stripe.
- A billing page in organisation settings: current plan, change plan (Checkout), manage
  (Portal), invoices. A failed payment shows a banner to admins.
- PostHog events for the funnel: plan viewed, checkout started, subscribed, cancelled, payment
  failed, server-side where the server knows.
- Test mode by default. `.env.example` and `deploy/RAILWAY.md` list the keys; live keys are the
  app owner's step.
- Tests: webhook handling with recorded fixtures; an e2e run through Checkout in test mode where
  CI allows it.

## Acceptance criteria

1. WHEN an organisation owner picks a plan THE app SHALL send them to Stripe Checkout and, after
   payment, SHALL show the plan as active within a minute.
2. WHEN Stripe sends the same event twice THE app SHALL apply it once.
3. WHEN a subscription is cancelled or a payment fails THE app's entitlements SHALL follow, and
   admins SHALL see why.
4. WHEN a member who isn't an owner or admin opens billing THE app SHALL show the plan but not
   let them change it.
5. WHEN the Stripe keys aren't set THE app SHALL run with billing switched off and say so on the
   billing page.

## Implementation Notes

Built on the `autopilot/18-billing` branch.

### Plugin or own module

Our own module, `apps/server/src/modules/billing`. Better Auth's Stripe plugin
(`@better-auth/stripe`, checked against its docs on 1 November 2026) does cover organisation
subscriptions (`referenceId` with `authorizeReference`, `organization: { enabled: true }`),
trials and the Customer Portal. It falls short where this PRD and the affiliate work after it
need it:

- Its webhook handles checkout and the three subscription events. `invoice.paid` and
  `invoice.payment_failed` only reach a catch-all `onEvent`, so the payment-failure state and the
  invoice-paid hook would be ours anyway.
- It doesn't store processed event ids, and its writes go through Better Auth's adapter, so an
  event id can't be recorded in the same transaction as the event's effects. A listener that
  writes commissions needs exactly that.
- It has no invoice list, and its trial eligibility rule can't be configured.
- It puts billing tables in Better Auth's schema and ties billing upgrades to auth upgrades.

The module is under 1,000 lines of server code with one new dependency (`stripe`). It owns its
tables and migration. There is no separate decisions file in the starter, so the decision lives
here.

### What was built

- **Contracts** (`packages/contracts/src/billing.ts`): an example Free, Pro and Team plan
  config, each with a display price, trial days and entitlements (seats, projects, features).
  Also the rules for which statuses grant a plan, when a subscription is open and when a payment
  counts as failing, and the billing DTOs. The web app and the API read the same file.
- **Database** (`packages/db/src/schema/billing.ts`, migration `0002_billing.sql`):
  - `billing_customers` links an organisation to its Stripe customer.
  - `subscriptions` mirrors each Stripe subscription, plus `payment_failed_at` and
    `stripe_event_at`.
  - `billing_events` holds processed event ids.
  - Rows go with their organisation when it is deleted.
- **Server routes**:
  - `GET /api/organizations/:id/billing` returns the summary to any member.
  - `POST .../checkout`, `POST .../portal` and `GET .../invoices` are for owners and admins;
    anyone else gets 403.
  - All four are in the OpenAPI document.
- **Webhook** (`POST /api/billing/webhook`):
  - It verifies the signature against the raw body.
  - It records the event id and applies the event in one transaction. A redelivered event gets
    200 with `duplicate: true` and changes nothing.
  - It ignores subscription events older than the one already stored, so out-of-order
    delivery can't roll a subscription back.
- **Invoice-paid hook**: `invoicePaid` listeners passed to `createBilling` run inside the webhook
  transaction. Each gets an `InvoicePaid` record: organisation, subscription, plan, amount,
  currency, billing reason and paid time. If a listener throws, the event rolls back and Stripe
  delivers it again. Other modules read an organisation's plan with
  `billing.entitlements(organizationId)`.
- **Analytics**: `billing.checkout_started`, `billing.subscribed`, `billing.cancelled` and
  `billing.payment_failed` go out after the transaction commits. They are attributed to the
  user who started checkout, or to `organization:<id>` when that user isn't known.
- **Checkout**:
  - It offers a 14-day trial on an organisation's first subscription only.
  - It refuses a second checkout while a subscription is open (409). Plan changes go through
    the portal instead.
  - It reuses the organisation's Stripe customer.
- **Organisation deletion**: deleting an organisation with an open subscription is refused.
- **Billing switched off**: billing stays off unless both `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET` are set.
  - The summary says `enabled: false`.
  - The other billing routes and the webhook answer 503.
  - The server logs which settings are missing.
  - Stored plans still resolve, so a deploy that loses its keys doesn't drop paying
    organisations to Free.
- **Web**: a billing page at `/organisations/:id/billing`, linked from the organisation panel.
  - The page shows:
    - the current plan, with its status and entitlements;
    - plan cards that start Checkout, or point to the portal while a subscription is open;
    - Manage billing (the portal);
    - invoices, for owners and admins;
    - a failed-payment alert;
    - the switched-off message.
  - After Checkout it checks again every 2 seconds for up to a minute.
  - Owners and admins of the active organisation see a banner on other pages when a payment
    fails.
  - The browser sends `billing_plans_viewed`.

### Decisions along the way

- **Payment failures**: `past_due` keeps the plan while Stripe retries. `unpaid`, `canceled`,
  `paused` and incomplete subscriptions drop to Free. To cut access on the first failed payment,
  remove `past_due` from `entitledStatuses` in the contracts.
- **Price changes**: price settings are comma-separated lists, so a price change doesn't strand
  existing subscribers. Checkout uses the first price.
- **The portal**: plan changes, cancellation and card updates happen in the Customer Portal. It
  has to be set up in Stripe to allow switching between the paid prices.
- **Entitlements**: they are defined and served, but nothing enforces them yet. The seat and
  project limits are examples for the app to apply.
- **Price labels**: the display price in the contracts is a label. Checkout shows the real
  amount, so keep the two in step.

### Environment

Four server variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO` and
`STRIPE_PRICE_TEAM`.

- They are listed in `apps/server/.env.example`, `deploy/.env.example`, `deploy/compose.yaml`,
  `turbo.json` (dev pass-through) and `deploy/RAILWAY.md`.
- README step 7 covers test keys, prices, the portal and `stripe listen`.
- The web app needs no Stripe settings.

### Tested

1. **Checkout, then active within a minute.**
   - The server integration test "billing follows Stripe through checkout, failed payment and
     cancellation" checks the checkout parameters with a mocked Stripe client. It then sends
     signed checkout and subscription events and checks that the plan turns Pro.
   - The browser test "an owner picks a plan, goes to Checkout and sees it active on return"
     uses a stubbed API and Checkout page. The page keeps checking until the plan turns.
2. **The same event twice is applied once.**
   - The integration test redelivers each event and gets `duplicate: true`.
   - The invoice hook runs once, even after a failed first attempt.
   - Removing the guard makes the test fail.
3. **Cancellation and payment failure.**
   - The integration test:
     - checks that a failed payment plus `past_due` keeps Pro and sets `paymentFailed`;
     - checks that deletion with reason `payment_failed` drops to Free and keeps the reason;
     - checks that a stale event is ignored. Removing the ordering guard makes this fail.
   - Web unit tests "tells admins a payment failed and how to fix it" and "says why a cancelled
     subscription ended".
   - A browser test covers the banner.
4. **A member can't change the plan.**
   - The integration test checks three cases:
     - a member gets the summary with `canManage: false`, and 403 on checkout, the portal and
       invoices;
     - an outsider gets 403;
     - a signed-out request gets 401.
   - The web unit test "shows a member the plan but no way to change it" and a browser test
     cover the page.
5. **No keys.**
   - The unit test "the webhook refuses unsigned, wrongly signed and unconfigured deliveries".
   - The integration test checks the switched-off app: the summary says `enabled: false`, and
     checkout and the webhook answer 503.
   - Web unit and browser tests check the message.

Not tested:

- **No contact with Stripe**: nothing here has talked to Stripe. The fixtures in
  `apps/server/tests/fixtures/stripe` are written by hand in the shape of API version
  `2026-10-28.endive`, not recorded from an account. The tests compute the signatures. Before
  relying on them, record real events with `stripe listen` and `stripe trigger` and compare.
- **No real Checkout run**: there are no Stripe test keys in CI, so no end-to-end run goes
  through real Checkout. The browser tests stub the API and the Checkout page.
- **The Customer Portal**: plan switching and cancellation in the portal are Stripe's. Only the
  events they produce are tested.
- **Two checkouts at once**: two checkouts started together in two tabs could create two
  subscriptions. The 409 guard only sees subscriptions the webhook has already recorded.

### Checks run

- `pnpm verify`, with `TEST_DATABASE_URL` pointing at a migrated, disposable database:
  - lint and types are clean;
  - server tests pass 16 of 16, integration tests included;
  - web tests pass 22 of 22;
  - the build passes.
- `pnpm test:e2e` passes 16 of 16: the auth and billing tests on desktop Chrome and mobile
  WebKit.
