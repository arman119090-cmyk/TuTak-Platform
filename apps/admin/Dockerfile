# Next.js is built here, not at container start, so the image that boots is
# the image that was tested. `NEXT_PUBLIC_*` values are inlined into the
# client bundle by that build, which is why the API base URL arrives as a
# build argument rather than an environment variable — setting it at runtime
# would have no effect on code already shipped to the browser.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/design/package.json packages/design/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile --filter @tutak/admin...

FROM deps AS build
COPY packages ./packages
COPY apps/admin ./apps/admin
COPY tsconfig.base.json ./tsconfig.base.json
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
# ── Sentry, all of it build-time ────────────────────────────────────────
#
# Every one of these has to be present during `next build` and none of them
# can be supplied later: `NEXT_PUBLIC_*` values are inlined into the client
# bundle by that build, and the source-map upload happens inside it too.
# Render's only channel into a Docker build is a build argument, which is
# why each one is an ARG here. All default to empty, and an empty DSN is a
# documented no-op in the SDK — the image builds with none of them set.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT

# The release every Sentry event is tagged with. `GIT_COMMIT_SHA` is this
# repository's canonical name (packages/observability/src/release.ts) and no
# platform sets it by itself; `RENDER_GIT_COMMIT` is what Render exports for
# the deployed commit. Preferring the explicit one and falling back keeps a
# release accurate without anyone pasting a SHA by hand; with neither set the
# release reads `unknown`, which is what it did before.
ARG GIT_COMMIT_SHA=""
ARG RENDER_GIT_COMMIT=""
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA:-$RENDER_GIT_COMMIT}

# Source-map upload only, read by next.config.ts. Without a token the upload
# is skipped and the build still succeeds.
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
# A secret, and the one value here that must not survive the build. It is
# deliberately never promoted to ENV: it is passed to the build command
# alone, on the line below. This whole stage is then discarded — the runtime
# stage starts from `base` again and copies only built output — so the token
# cannot appear in the published image, in its history, or in any layer of
# it.
ARG SENTRY_AUTH_TOKEN=""

RUN SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" \
    pnpm --filter @tutak/admin build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/admin ./apps/admin

# `next start` writes into `.next/cache` at runtime (image optimization,
# fetch cache), so that one directory has to be owned by the user the
# server runs as. Everything else stays root-owned and read-only to the
# process — code the running server cannot rewrite is the point of
# dropping privileges in the first place.
RUN chown -R node:node /repo/apps/admin/.next

EXPOSE 3000
WORKDIR /repo/apps/admin

# See the API image for the reasoning. Port 3000 needs no privilege, and
# this container renders operator sessions — the audience an XSS or a
# compromised dependency would most like to reach.
USER node
# Invoked directly, not through `pnpm exec`. The runtime image has
# corepack enabled but no cached pnpm and no root package.json, so
# corepack could not see the pinned packageManager version and
# downloaded the newest pnpm on every container start — which needs a
# newer Node than this image has, and crashed. A container should not
# need the network to start.
CMD ["./node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
