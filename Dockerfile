# Build: install the workspace and bundle the API into apps/api/dist.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @prepup/api build

# Run: just Node, the bundle and the SQL migrations. No node_modules needed.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    MIGRATIONS_DIR=/app/migrations
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/db/migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/server.js"]
