# Production image for the demo furniture store.
# Multi-stage: dependencies, build, then a slim runtime that seeds on first run.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 3100
# Migrations run on boot so a fresh database is usable immediately; the seed is
# opt-in through SEED_ON_START so a real deployment never overwrites its data.
CMD ["sh", "-c", "npx prisma migrate deploy && { [ \"$SEED_ON_START\" = \"1\" ] && npx tsx prisma/seed.ts || true; } && npx next start --port ${PORT:-3100}"]
