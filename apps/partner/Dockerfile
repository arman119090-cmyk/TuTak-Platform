# See apps/admin/Dockerfile for why the API base URL is a build argument:
# Next.js inlines NEXT_PUBLIC_* into the browser bundle at build time.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/design/package.json packages/design/package.json
COPY apps/partner/package.json apps/partner/package.json
RUN pnpm install --frozen-lockfile --filter @tutak/partner...

FROM deps AS build
COPY packages ./packages
COPY apps/partner ./apps/partner
COPY tsconfig.base.json ./tsconfig.base.json
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
# ── Sentry: build-time, and deliberately optional ───────────────────────
#
# `NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`,
# so they cannot be supplied later; a build argument is the only channel a
# Docker build has. Whether a given platform forwards a service variable to
# a matching ARG is that platform's behaviour, not something this image can
# require — so all of these default to empty and an empty DSN is a
# documented no-op in the SDK. The image builds, and the dashboard serves,
# with none of them set; the only thing missing then is Sentry itself.
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

# There is deliberately no SENTRY_AUTH_TOKEN argument here. Uploading source
# maps needs a token with write access to the Sentry project, and a hosting
# platform that has no build-only variables would keep that token in the
# running container's environment for the life of the service. That trade is
# not worth readable stack traces. Source-map upload belongs in a CI build
# with a short-lived token — see docs/RENDER_STAGING_RU.md §8. Without a
# token `next.config.ts` skips the upload and the build succeeds.
RUN pnpm --filter @tutak/partner build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/partner ./apps/partner

# `next start` writes into `.next/cache` at runtime (image optimization,
# fetch cache), so that one directory has to be owned by the user the
# server runs as. Everything else stays root-owned and read-only to the
# process — code the running server cannot rewrite is the point of
# dropping privileges in the first place.
RUN chown -R node:node /repo/apps/partner/.next

EXPOSE 3001
WORKDIR /repo/apps/partner

# See the API image for the reasoning.
USER node
# Invoked directly, not through `pnpm exec`. The runtime image has
# corepack enabled but no cached pnpm and no root package.json, so
# corepack could not see the pinned packageManager version and
# downloaded the newest pnpm on every container start — which needs a
# newer Node than this image has, and crashed. A container should not
# need the network to start.
CMD ["./node_modules/.bin/next", "start", "--port", "3001", "--hostname", "0.0.0.0"]
