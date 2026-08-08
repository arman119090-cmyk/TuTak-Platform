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

exec node dist/main.js
