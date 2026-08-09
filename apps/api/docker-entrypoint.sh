#!/bin/sh
set -e

# Applies the migration history the image was built with before the process
# starts serving traffic. `migrate deploy` only ever applies pending
# migrations in order and refuses on drift — it does not diff or generate,
# so it is safe to run unattended on every container start, including a
# rolling deploy where several instances race to run it: the second and
# later ones find nothing pending and exit immediately.
#
# Invoked through node_modules directly rather than `pnpm run`. A container
# must not need the network to start, and `pnpm` here did: the runtime image
# has corepack enabled but no cached pnpm and no root package.json, so
# corepack found no `packageManager` field, downloaded whatever pnpm was
# newest, and crashed on a Node version that pnpm no longer supports. The
# binary is already in the image; use it.
./node_modules/.bin/prisma migrate deploy

# ── Seeding a demonstration ─────────────────────────────────────────────
#
# A hosted demo has nobody who can open a terminal. Whoever deployed it has
# a phone and a browser, and an empty platform is not a demonstration — every
# screen renders its empty state and nothing can be judged. So the demo
# seeds itself on first boot.
#
# Gated on DEMO_SEED being exactly "true", separately from DEMO_MODE, because
# the two answer different questions: DEMO_MODE says "this instance may use a
# fake acquirer", DEMO_SEED says "put invented customers and payments in this
# database". A real deployment must never do the second even by accident, and
# a second flag means an accident needs two mistakes.
#
# Both scripts are safe to run on every restart. `seed-baseline` upserts
# roles and permissions; `seed-demo` detects the partner it created last time
# and stops. Neither writes a money row directly — payments go through the
# real engines, so if an invariant is broken this fails loudly instead of
# fabricating rows that look plausible.
if [ "${DEMO_SEED:-}" = "true" ]; then
  echo "DEMO_SEED=true — seeding baseline roles and demonstration data"
  node dist/scripts/seed-baseline.js
  TUTAK_DEMO=1 node dist/scripts/seed-demo.js
fi

exec node dist/main.js
