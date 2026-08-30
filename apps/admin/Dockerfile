# Next.js is built here, not at container start. Values prefixed with
# NEXT_PUBLIC_ are inlined into the browser bundle during `next build`.
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

# These build arguments are optional. The image must build successfully when
# the hosting platform does not provide any build-time values.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1
ARG NEXT_PUBLIC_SENTRY_DSN=""
# Staging is the safe default for this staging Dockerfile path; do not depend
# on a runtime Render variable being forwarded into Docker ARG.
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
RUN pnpm --filter @tutak/admin build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/admin ./apps/admin

RUN chown -R node:node /repo/apps/admin/.next

EXPOSE 3000
WORKDIR /repo/apps/admin
USER node
CMD ["./node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
