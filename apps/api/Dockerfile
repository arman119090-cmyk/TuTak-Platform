FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
# argon2 ships prebuilt binaries for glibc but not for musl, so on Alpine
# node-gyp-build falls back to compiling it — and the base image has no
# compiler. Without these three packages the install dies on
# "Could not find any Python installation to use" and the image never
# builds at all. They stay in this stage: the runtime image copies the
# compiled node_modules and needs no toolchain of its own.
RUN apk add --no-cache python3 make g++
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @tutak/api...

FROM deps AS build
COPY . .
RUN pnpm --filter @tutak/api prisma:generate
RUN pnpm --filter @tutak/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh

EXPOSE 4000
WORKDIR /repo/apps/api
ENTRYPOINT ["./docker-entrypoint.sh"]
