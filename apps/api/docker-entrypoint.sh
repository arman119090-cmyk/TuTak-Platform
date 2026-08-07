#!/bin/sh
set -e

# Applies the migration history the image was built with before the process
# starts serving traffic. `migrate deploy` only ever applies pending
# migrations in order and refuses on drift — it does not diff or generate,
# so it is safe to run unattended on every container start, including a
# rolling deploy where several instances race to run it: the second and
# later ones find nothing pending and exit immediately.
pnpm run prisma:deploy

exec node dist/main.js
