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

# Drop root before the process starts.
#
# Nothing here needs it: the image is built already, migrations run over a
# TCP connection, and port 4000 is above 1024 so no privileged bind is
# involved. What it buys is that a remote-code-execution bug in a
# dependency lands as an unprivileged user rather than as root inside the
# container, where the only thing left between it and the host is the
# container runtime's own configuration.
#
# `node` (uid 1000) ships in the official image. The copied files stay
# owned by root and world-readable, which is what we want — the process
# can read its own code and cannot rewrite it.
USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
