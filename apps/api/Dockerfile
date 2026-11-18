# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
# The whole workspace is copied so the lockfile matches; .dockerignore keeps it small.
COPY . .
RUN pnpm install --frozen-lockfile --filter @todo/api...
RUN pnpm --filter @todo/api build && pnpm --filter @todo/api deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
ENV MIGRATIONS_DIR=/app/drizzle
USER node
EXPOSE 3000
# Applies pending migrations, then starts the API (and the in-process worker if enabled).
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
