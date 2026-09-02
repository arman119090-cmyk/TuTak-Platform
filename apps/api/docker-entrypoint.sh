#!/bin/sh
set -e

# ── The release every error report is tagged with ───────────────────────
#
# `GIT_COMMIT_SHA` is this repository's canonical name for it
# (packages/observability/src/release.ts), read here by Sentry and by the
# structured logs. No platform sets that name by itself; Render exports the
# deployed commit as `RENDER_GIT_COMMIT`. Falling back to it means a staging
# deployment tags its events with the commit it is actually running without
# anyone pasting a SHA into the dashboard and forgetting to update it. An
# explicit value still wins, and with none of them set nothing changes: the
# release stays `unknown`, exactly as before.
#
# Railway exports the same fact under its own name, so the same reasoning
# applies there: without this, every production error report would be tagged
# `unknown` and there would be no way to tell which commit produced it.
if [ -z "${GIT_COMMIT_SHA:-}" ] && [ -n "${RENDER_GIT_COMMIT:-}" ]; then
  export GIT_COMMIT_SHA="$RENDER_GIT_COMMIT"
fi
if [ -z "${GIT_COMMIT_SHA:-}" ] && [ -n "${RAILWAY_GIT_COMMIT_SHA:-}" ]; then
  export GIT_COMMIT_SHA="$RAILWAY_GIT_COMMIT_SHA"
fi

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

# ── Seeding the baseline ────────────────────────────────────────────────
#
# Permissions, roles and one super admin. No business data, no invented
# customers, no money — `seed-baseline` is the seed that is safe to run
# against any environment, and every write in it is an upsert, so a restart
# costs nothing and an existing admin's password is left alone.
#
# A fresh database has none of this, and without roles nobody can sign in to
# the admin or partner dashboard at all. That is why staging needs its own
# flag: DEMO_SEED also invents partners, customers and payments, which a
# staging environment must never have. Two different jobs, two different
# variables.
#
# Requires SEED_ADMIN_PASSWORD (at least 12 characters); the script refuses
# without one, and refusing loudly here is better than a container that
# starts with no way in.
if [ "${SEED_BASELINE:-}" = "true" ]; then
  echo "SEED_BASELINE=true — seeding permissions, roles and the super admin"
  node dist/scripts/seed-baseline.js
fi

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

# ── One-time recovery: the bootstrap administrator's password ───────────
#
# Off unless an operator deliberately turns it on, and meant to be turned
# back off the moment it has worked. It exists because a hosted staging
# environment on a plan with no shell has no other way back in once the
# bootstrap password is lost or has to be treated as compromised —
# `seed-baseline` will not rewrite an existing admin's password, and that is
# the correct behaviour to leave alone.
#
# The guard below duplicates the one inside the script on purpose. The
# script's check is the one that actually protects the database; this one
# means a wrong environment fails before a Node process, a Prisma client and
# a database connection are even created, and it fails the boot rather than
# quietly continuing — an operator who set this flag is waiting on a password
# that must either work or say why not.
if [ "${RESET_STAGING_ADMIN_PASSWORD:-}" = "true" ]; then
  if [ "${NODE_ENV:-}" != "staging" ]; then
    echo "RESET_STAGING_ADMIN_PASSWORD=true but NODE_ENV=${NODE_ENV:-<unset>}." >&2
    echo "This recovery path is for staging only. Refusing to start." >&2
    exit 1
  fi
  echo "RESET_STAGING_ADMIN_PASSWORD=true — recovering the bootstrap administrator"
  node dist/scripts/reset-staging-admin-password.js
fi

exec node dist/main.js
