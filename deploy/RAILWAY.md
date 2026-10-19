# Railway template

The template deploys the starter with no input. It creates three services on one private network:

- `Postgres`, Railway's PostgreSQL database.
- `server`, the Hono API, built from `deploy/server.Dockerfile`. It runs migrations as its pre-deploy command and has no public domain.
- `web`, Caddy built from `deploy/web.Dockerfile`. It serves the SPA and proxies the API to `server` over the private network. It holds the only public domain, so the SPA and the API share one HTTPS origin and the auth cookies stay first-party.

Keep the service names exactly as written: the variable references below use them.

## Settings live in the template, not in railway.json

Railway has deprecated Config as Code. Services in projects created after 28 August 2026 do not read `railway.json` or `railway.toml`, and existing files stop being read on 1 December 2026. A template deploy always creates a new project, so every setting below belongs in the template's service settings. The Dockerfile path is set with the `RAILWAY_DOCKERFILE_PATH` variable, so it travels with the variables.

## Postgres

| Setting | Value |
| --- | --- |
| Source | Railway PostgreSQL database (New, Database, PostgreSQL) |
| Service name | `Postgres` |
| Volume | The volume the database creates, mounted at `/var/lib/postgresql/data` |
| Networking | Private only. Remove the TCP proxy so the database has no public address. |
| Variables | The database's own. Leave them as they are. |

## server

| Setting | Value |
| --- | --- |
| Source | GitHub repo `dougwithseismic/react-saas-starter`, branch `main` |
| Root directory | `/` (the Dockerfile copies the whole workspace) |
| Builder | Dockerfile, from `RAILWAY_DOCKERFILE_PATH` |
| Pre-deploy command | `node apps/server/dist/migrate.mjs` |
| Start command | Empty. The image runs `node apps/server/dist/index.mjs`. |
| Healthcheck path | `/health/ready` (answers 200 once the database responds) |
| Healthcheck timeout | 300 seconds, the default |
| Restart policy | On failure, 10 retries |
| Networking | Private only. No public domain. |
| Volumes | None |
| Replicas | 1 |

Watch paths:

```text
/apps/server/**
/packages/db/**
/packages/contracts/**
/packages/typescript-config/**
/deploy/server.Dockerfile
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/.dockerignore
```

Variables:

| Variable | Value | Description |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/server.Dockerfile` | Dockerfile for the API image. |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Private connection string for the database. |
| `BETTER_AUTH_SECRET` | `${{secret(64)}}` | Signs sessions. Generated once per deploy of the template. |
| `BETTER_AUTH_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | Public origin that auth links and callbacks use. |
| `APP_ORIGIN` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | The only origin allowed to call the API. |
| `NODE_ENV` | `production` | Enables secure cookies. |
| `PORT` | `4301` | API port on the private network. |
| `TRUSTED_PROXY_IPS` | `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,fc00::/7` | Private ranges the proxy connects from. See Client addresses. |
| `LOG_LEVEL` | `info` | Pino log level. |

Optional, left out of the template so nothing has to be typed. Add them to `server` after deploying:

| Variable | Description |
| --- | --- |
| `LOOPS_API_KEY` | Loops API key. Server only. |
| `LOOPS_RESET_PASSWORD_TEMPLATE_ID` | Published Loops template for password reset. |
| `LOOPS_VERIFY_EMAIL_TEMPLATE_ID` | Published Loops template for verification and email changes. |
| `LOOPS_INVITATION_TEMPLATE_ID` | Published Loops template for organisation invitations. |
| `POSTHOG_PROJECT_KEY` | PostHog project key for server events. |
| `POSTHOG_HOST` | PostHog ingestion host, for example `https://eu.i.posthog.com`. |

## web

| Setting | Value |
| --- | --- |
| Source | GitHub repo `dougwithseismic/react-saas-starter`, branch `main` |
| Root directory | `/` |
| Builder | Dockerfile, from `RAILWAY_DOCKERFILE_PATH` |
| Pre-deploy command | None |
| Start command | Empty. The image runs Caddy with `deploy/Caddyfile`. |
| Healthcheck path | `/` (the SPA's `index.html`, so it does not depend on the API) |
| Healthcheck timeout | 300 seconds, the default |
| Restart policy | On failure, 10 retries |
| Networking | Public. Generate a Railway domain with target port `8080`. |
| Volumes | None |
| Replicas | 1 |

Watch paths:

```text
/apps/web/**
/packages/ui/**
/packages/contracts/**
/packages/typescript-config/**
/deploy/web.Dockerfile
/deploy/Caddyfile
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/.dockerignore
```

Variables:

| Variable | Value | Description |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/web.Dockerfile` | Dockerfile for the web image. |
| `PORT` | `8080` | Caddy serves plain HTTP here; Railway terminates TLS. |
| `API_UPSTREAM` | `${{server.RAILWAY_PRIVATE_DOMAIN}}:${{server.PORT}}` | Where Caddy proxies `/api`, `/docs`, `/openapi.json` and `/health`. |
| `TRUSTED_PROXIES` | `0.0.0.0/0 ::/0` | Lets Caddy take the client address from Railway's `X-Real-IP`. See Client addresses. |

Do not set `SITE_ADDRESS` on Railway. When it is unset, Caddy serves plain HTTP on `PORT` for any host name. The Compose deploy sets it to the public host so Caddy obtains certificates.

Optional, added after deploying. Both are compiled into the SPA, so redeploy `web` after changing them:

| Variable | Description |
| --- | --- |
| `VITE_POSTHOG_PROJECT_KEY` | Public PostHog project key for browser events. |
| `VITE_POSTHOG_HOST` | PostHog ingestion host. Defaults to `https://us.i.posthog.com`. |

## Client addresses

Rate limits and session records use the client's address, so it has to survive two proxies without being spoofable.

1. Railway's edge terminates TLS and sets `X-Real-IP` to the connecting address, replacing any value the client sent. Railway does not publish the edge's address range, so `web` trusts `X-Real-IP` from any peer (`TRUSTED_PROXIES=0.0.0.0/0 ::/0`). This is safe because `web` can only be reached through the edge or from the project's own private network. Never set it in the Compose deploy, where Caddy is the first hop.
2. Caddy replaces `X-Forwarded-For` with the single address it resolved and proxies to `server`.
3. The server reads `X-Forwarded-For` only when the socket peer is inside `TRUSTED_PROXY_IPS`. Railway assigns private network addresses per deploy and does not publish the range, so the server trusts the private ranges (RFC 1918, `100.64.0.0/10` and IPv6 `fc00::/7`). Only services in the project can reach the server, because it has no public domain. Keep it that way.

The server listens on `::`, so it accepts both IPv4 and IPv6 private traffic, including environments created before 16 October 2025 that are IPv6 only.

## Email and analytics without configuration

The server starts without Loops or PostHog and logs a warning that names the missing Loops variables.

- Sign-up, sign-in, sign-out, sessions and organisations work.
- Password reset answers with the usual "if this account exists" message but sends nothing. The server log shows `Email delivery is not configured`.
- Verification and email change requests return 503 with "Email delivery is not configured. Contact your administrator."
- Invitations are created and their links can be copied from the organisation page, but accepting one needs a verified email, so it cannot complete until Loops is configured.
- Analytics are off in the server and the browser.

## Build the template

The reliable route is to build a working project first and generate the template from it.

1. Create an empty project. Add PostgreSQL, keep the name `Postgres` and remove its TCP proxy.
2. Add the GitHub repo as a service named `server`. Apply the settings, watch paths and variables above. Template functions only run in templates, so for this project set `BETTER_AUTH_SECRET` to the output of `openssl rand -base64 48`.
3. Add the same repo again as a service named `web`. Apply its settings, watch paths and variables, then generate a domain with target port `8080`.
4. Deploy and run the checks below.
5. In the project settings, choose Generate Template from Project. In the composer, set `BETTER_AUTH_SECRET` to `${{secret(64)}}` to generate a secret for each deploy. Check each service against the tables above. The generator keeps references, the pre-deploy command, healthchecks, restart policies, volumes and the domain's target port. It leaves all plain variables empty and required, so re-enter their values, including the database's own. Templates omit watch paths; add them to the deployed project to rebuild only the service a push touches.
6. Apply the changes and deploy the template into a new project to run the checks again. Add the template URL to the README button.

## Check a deploy

1. The `server` deploy log shows the pre-deploy step logging `Migrations up to date`, then `API started`.
2. `https://<web domain>/health/ready` returns `{"status":"ready"}`.
3. Sign up at `/sign-up`, sign out, sign in again and create an organisation at `/organisations`.
4. In the database, `select ip_address from session order by created_at desc limit 1;` returns your own public address. A private address means `X-Real-IP` did not arrive or a trust range is wrong.
5. Redeploy `server`: the pre-deploy step runs again and applies nothing new. Restart it: no migration runs.

## Custom domain

Add the domain to `web`, then set `BETTER_AUTH_URL` and `APP_ORIGIN` on `server` to `https://<custom domain>` and redeploy `server`. Sign-in from any other origin is refused.
