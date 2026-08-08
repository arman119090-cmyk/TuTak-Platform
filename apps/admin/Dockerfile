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
RUN pnpm --filter @tutak/admin build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/admin ./apps/admin

EXPOSE 3000
WORKDIR /repo/apps/admin
CMD ["pnpm", "exec", "next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
