# See apps/admin/Dockerfile: Next.js public variables are build-time values.
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

# These build arguments are optional. The image must build successfully when
# the hosting platform does not provide any build-time values.
#
# `NEXT_PUBLIC_API_BASE_URL` defaults to empty rather than to a localhost URL:
# this value decides the `connect-src` of the Content-Security-Policy, and a
# default that looks like a real answer cannot be told apart from one. Empty
# means "nobody configured this", which is Render's case, and api-base-url.mjs
# turns it into the staging API. Anyone who wants localhost — docker-compose,
# and CI, which boots that stack and drives it in a browser — passes it.
ARG NEXT_PUBLIC_API_BASE_URL=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging
ARG GIT_COMMIT_SHA=""

ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1

# Source-map generation/upload is deliberately disabled in next.config.ts for
# the initial staging deployment. SENTRY_AUTH_TOKEN, SENTRY_ORG and
# SENTRY_PROJECT therefore do not belong in this Dockerfile or in Render's
# runtime environment. See docs/SENTRY_SOURCEMAPS_FUTURE_RU.md.
RUN pnpm --filter @tutak/partner build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/partner ./apps/partner

RUN chown -R node:node /repo/apps/partner/.next

EXPOSE 3001
WORKDIR /repo/apps/partner
USER node
CMD ["./node_modules/.bin/next", "start", "--port", "3001", "--hostname", "0.0.0.0"]
