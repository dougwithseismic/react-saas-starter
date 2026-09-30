# React SaaS Starter

An account and organisation starter with React, Vite, TypeScript, TanStack Router/Query, Hono, Better Auth, Drizzle and PostgreSQL. It includes sign-in, account settings, sessions, organisations, member roles and invitations. Product features belong in separate feature modules.

## Create an application

This private repository is a GitHub template:

```sh
gh repo create my-app --private --template dougwithseismic/react-saas-starter --clone
cd my-app
```

Then follow local setup and replace the UI tokens and feature screens with your reference design.

## Local setup

Use Node.js 24+, pnpm (the root `packageManager` pins its version), and Docker with Compose.

```sh
corepack enable
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
openssl rand -base64 48
```

Put the generated value in `apps/server/.env` as `BETTER_AUTH_SECRET` before starting. The example PostgreSQL credentials are for local development.

```sh
docker compose up -d --wait
DATABASE_URL=postgresql://starter:starter@localhost:5433/starter pnpm db:migrate
pnpm dev
```

Open [the sign-in page](http://localhost:4300/sign-in). The SPA runs on port **4300**, the Hono server on **4301**, and local PostgreSQL on **5433**. Browser requests use the frontend origin; Vite proxies `/api`, `/docs`, `/openapi.json` and `/health` to the server. Keep `APP_ORIGIN` and `BETTER_AUTH_URL` at `http://localhost:4300` for local use.

The UI route `/sign-in` renders a form. Its API is `POST /api/auth/sign-in/email`, with JSON `{ "email": "…", "password": "…" }`. Better Auth owns password hashing, session cookies, CSRF checks and authentication endpoints; frontend guards do not replace server authorization. Explore [Scalar](http://localhost:4300/docs) and [OpenAPI](http://localhost:4300/openapi.json).

## Organisation invitations and email

Email uses Loops transactional templates. Set the server-only `LOOPS_API_KEY` and the published template IDs `LOOPS_RESET_PASSWORD_TEMPLATE_ID`, `LOOPS_VERIFY_EMAIL_TEMPLATE_ID` and `LOOPS_INVITATION_TEMPLATE_ID`. The verification template also handles email changes. All templates receive `url` and `name`; the invitation template additionally receives `organizationName`, and its `name` is the inviter’s name. Use `url` as the action link. Transactional sends use `addToAudience: false`, so account emails do not add recipients to a marketing audience. Configure the sender in Loops. Without delivery configured, pending invitation links can be shared manually, but a new recipient still needs a verified email before accepting. Email-dependent operations return an actionable configuration error; no email delivery is simulated.

Owner/admin/member permissions are enforced by Better Auth on the server. PostgreSQL's last-owner migration prevents removing the final owner, including account deletion. Owners must transfer ownership or delete an organisation before deleting their account.

## Logging and analytics

Structured server logs use Pino. Browser and server analytics go through local abstractions with optional PostHog sinks; keys unset means analytics is disabled. Set `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST` on the server, and `VITE_POSTHOG_PROJECT_KEY` and `VITE_POSTHOG_HOST` for the browser. Hosts default to `https://us.i.posthog.com`; choose your project's ingestion host. The browser key is a public project key, never a personal API key.

Browser environment values are compiled into Vite output. Changing them requires a new web build; production Compose passes them as Docker build arguments. Loops secrets remain server-only. Analytics emits minimal explicit events, without emails, authentication tokens or URL query strings. Custom sinks can replace PostHog behind the same interfaces without changing feature code.

The browser facade is `apps/web/src/lib/analytics.ts`; add a `ClientAnalyticsPlugin` with `analytics.use(...)` for another provider. It tracks page views and completed account/auth/organisation actions, identifies the signed-in user by internal ID, and resets identity on logout or a remote account change. Autocapture and session recording are disabled. Server hooks emit persisted account, session, organisation, member and invitation lifecycle events through `apps/server/src/modules/analytics/analytics.ts`; use `protectAnalytics` when supplying a custom sink. Provider errors do not fail account requests, and server shutdown flushes the event queue.

Request logs include request ID, method, path, status and duration; body contents, credentials and query strings are excluded. `LOG_LEVEL` controls verbosity. See the [Loops transactional guide](https://app.loops.so/docs/transactional/guide) when creating the published templates.

## Architecture

| Folder | Responsibility |
| --- | --- |
| `apps/web/src/app` | Router, providers and application styling |
| `apps/web/src/features` | Auth, account and organisation screens with feature-specific queries/forms |
| `apps/web/src/lib` | Auth client, HTTP client, Query configuration and cache invalidation |
| `apps/web/src/stores` | Non-sensitive UI preferences; remote data stays in TanStack Query |
| `apps/server/src/config` | Validated environment configuration |
| `apps/server/src/modules` | Auth, account, organisations and health logic and routes |
| `apps/server/src/routes` | Route composition |
| `apps/server/src/middleware` | Request logging, authentication and errors |
| `packages/db` | Drizzle schema, PostgreSQL connection and checked-in migrations |
| `packages/contracts` | Shared request/response schemas and DTOs |
| `packages/ui` | Design tokens and reusable UI primitives |
| `packages/typescript-config` | Shared compiler configuration |

Add domain-specific server modules and matching web features without mixing them into authentication. Put navigable state in router URLs, server state in Query, and reusable contracts in `packages/contracts`. Change theme tokens and UI primitives to apply a different visual design.

## Checks and migrations

```sh
pnpm verify
pnpm --filter @repo/web exec playwright install chromium webkit
pnpm test:e2e
# Include real persistence and multi-user permission tests against a disposable DB:
TEST_DATABASE_URL=postgresql://starter:starter@localhost:5433/starter_test pnpm test
```

Create the disposable test database and apply migrations to it before running integration tests. Integration tests skip when `TEST_DATABASE_URL` is absent. GitHub CI starts a fresh PostgreSQL database, migrates it and runs verification with integration tests enabled, then installs Chromium/WebKit and runs the browser checks. Lefthook installs through `pnpm install`; Biome handles formatting and linting.

After schema changes, use `DATABASE_URL=… pnpm db:generate`, review the generated SQL, then `DATABASE_URL=… pnpm db:migrate`. Migrations belong in version control. Use `pnpm add` for dependencies. `pnpm build` produces the Vite static site and the tsdown server bundle; `pnpm --filter @repo/server start` starts the compiled server. Vite preview serves static output and does not supply the development API proxy.

## Production containers

`deploy/compose.yaml` runs PostgreSQL, a one-shot migration service, the compiled Hono server, and Caddy serving the SPA. Caddy proxies API, documentation and health routes before its SPA fallback, so direct visits to `/sign-in`, account pages and invitation routes work. Only Caddy exposes ports; the API and database remain on the container network.

```sh
cp deploy/.env.example deploy/.env
# Fill in domain, database password/URL, auth secret and Loops credentials/template IDs.
docker compose --env-file deploy/.env -f deploy/compose.yaml config
docker compose --env-file deploy/.env -f deploy/compose.yaml up --build -d
```

Point the configured domain at this host and allow ports 80/443 for Caddy's HTTPS certificates. The database password must match the URL; URL-encode special characters. Keep backups outside the containers and protect `deploy/.env`. The server waits for successful migrations before starting. Use a single migration job when deploying multiple API replicas.

The Compose network reserves `172.29.71.20` for Caddy and trusts only that proxy IP for client-IP forwarding and authentication rate limits. If that subnet conflicts with your host, change the network and `TRUSTED_PROXY_IPS` together. External proxies require their verified socket IPs in the allowlist; never trust arbitrary forwarded headers. Caddy certificate data and PostgreSQL data persist in named volumes. Do not remove those volumes when upgrading.

Verify `/health/ready`, `/docs`, `/sign-in`, signup and cookie persistence on the public HTTPS origin after deploying. The Docker files are deployment templates; validate them with your host's Docker engine before a release.
