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

# `NEXT_PUBLIC_API_BASE_URL` is the one build argument a deployed image must
# be given. It decides the `connect-src` of the Content-Security-Policy, which
# is written into the build and cannot be changed by a runtime variable
# afterwards, so a build that guesses ships a policy forbidding its own API.
#
# It defaults to empty rather than to a localhost URL because a default that
# looks like a real answer cannot be told apart from one; empty means "nobody
# configured this", and `api-base-url.mjs` fails the build on it. Anyone who
# wants localhost — docker-compose, and CI, which boots that stack and drives
# it in a browser — passes it explicitly.
#
# Railway injects a service's variables into the Docker build for exactly the
# names the Dockerfile declares as `ARG`, which is why this line matters there
# and not only locally. Verify per environment rather than trusting it: the
# built bundle must mention the intended API host (docs/RAILWAY_PRODUCTION_RUNBOOK_RU.md §2).
#
# The remaining build arguments are optional and the image builds without them.
ARG NEXT_PUBLIC_API_BASE_URL=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
# `unknown`, not a guess at which deployment this is.
#
# This defaulted to `staging`, which was true while Render staging was the only
# thing built from this Dockerfile and became an active lie the moment Railway
# production used it too: every production error from this dashboard would be
# filed under the staging environment, where a production alert rule does not
# look for it. A misfiled error is worse than an unlabelled one, because the
# label makes it look handled.
#
# `production` would be the mirror-image lie for a staging build, so neither
# environment is a safe guess. `unknown` is the same answer this repository
# already gives for an unstated release (`GIT_COMMIT_SHA`), and it is visibly
# wrong in Sentry, which is how it gets fixed. Pass the real value as a build
# argument — on Railway, a service variable of this name reaches the ARG.
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=unknown
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

# The same value the build was given, carried into the running container.
#
# `next start` re-reads `next.config.ts` — that is where the response headers
# come from — so the runtime needs the answer the build used, and needs it to
# be the *same* answer. Leaving it out made the container exit on boot once
# the config stopped guessing, which CI caught as `curl: (52) Empty reply from
# server` against a dashboard that had already built cleanly.
#
# Declaring the ARG again here is how a value passed to `docker build` reaches
# a second stage; it is not a second source of truth.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/admin ./apps/admin

RUN chown -R node:node /repo/apps/admin/.next

EXPOSE 3000
WORKDIR /repo/apps/admin
USER node
# Listens on $PORT when the platform assigns one, and on the port this
# service has always used when it does not.
#
# Render lets a service declare its own port and docker-compose maps it, so a
# fixed number worked. Railway assigns the port and expects the process to read
# it: a container that ignores it listens where nothing is looking, and the
# platform reports a failed health check rather than a misconfiguration. Shell
# form on purpose — the exec form does no variable expansion — with `exec` so
# the server stays PID 1 and still receives SIGTERM.
CMD ["sh", "-c", "exec ./node_modules/.bin/next start --port ${PORT:-3000} --hostname 0.0.0.0"]
