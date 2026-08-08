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
