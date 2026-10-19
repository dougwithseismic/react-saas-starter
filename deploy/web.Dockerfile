FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
# The build context has no Git checkout, so skip lifecycle scripts such as the
# lefthook prepare hook. Nothing below depends on an install script.
RUN pnpm install --frozen-lockfile --ignore-scripts
ARG VITE_POSTHOG_PROJECT_KEY=
ARG VITE_POSTHOG_HOST=https://us.i.posthog.com
ENV VITE_POSTHOG_PROJECT_KEY=$VITE_POSTHOG_PROJECT_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN pnpm --filter @repo/web build

FROM caddy:2-alpine
COPY --from=build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
