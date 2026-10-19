FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
# The build context has no Git checkout, so skip lifecycle scripts such as the
# lefthook prepare hook. Nothing below depends on an install script.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @repo/server build

# Keep this stage last: Railway builds the final stage and cannot pick a target.
# The same image runs migrations with `node apps/server/dist/migrate.mjs`, so the
# pre-deploy step needs no package manager and writes nothing to the app folder.
FROM node:24-alpine AS server
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /workspace/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /workspace/packages/db/drizzle ./packages/db/drizzle
USER node
EXPOSE 4301
CMD ["node", "apps/server/dist/index.mjs"]
