# syntax=docker/dockerfile:1

# Mallowtick web app: Next.js standalone server, non-root.
# Build from the repository root (docker-compose.yml does), since the pnpm
# workspace and its lockfile live there:
#   docker build -f apps/web/Dockerfile -t mallowtick-web .
# API_ORIGIN is read at run time by the /api/v1 proxy route, not at build time.

ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-alpine3.23 AS base
# pnpm comes from corepack at the version in package.json's packageManager.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# Dependencies: only the manifests and the lockfile, so this layer is reused
# until they change. sharp needs no build script (allowBuilds: false); it ships
# prebuilt binaries for this platform (linuxmusl) as optional packages.
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@mallowtick/web..."

FROM deps AS build
COPY apps/web ./apps/web
# Inlined into the client bundle at build time (the app falls back to 60).
ARG NEXT_PUBLIC_QUOTE_REFRESH_SECONDS=60
ENV NEXT_PUBLIC_QUOTE_REFRESH_SECONDS=$NEXT_PUBLIC_QUOTE_REFRESH_SECONDS
RUN pnpm --filter @mallowtick/web build

# Runtime: the traced standalone server plus the static assets it serves.
# Next infers the workspace root (/repo) from pnpm-workspace.yaml, so the
# standalone tree mirrors the repo: apps/web/server.js and a pruned node_modules.
FROM node:${NODE_VERSION}-alpine3.23 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# The node user (uid 1000) can write .next/cache, where next/image keeps the
# resized company logos.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
