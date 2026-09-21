#!/bin/sh
# Builds the bundled database and the application inside the demo image.
# Used only by Dockerfile.demo.
set -eu

stop_database() {
  su postgres -c "pg_ctl -D $PGDATA -m immediate -w stop" 2>/dev/null || true
}

# The image builder waits for every process started by this step, so a failure
# that left the database running would hang the build forever instead of
# reporting the error. Stopping it on any exit keeps failures visible.
trap stop_database EXIT INT TERM

mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
su postgres -c "initdb -D $PGDATA -U demo --auth=trust"
su postgres -c "pg_ctl -D $PGDATA -o '-c listen_addresses=127.0.0.1' -w start"
su postgres -c "createdb -U demo furniture_shop"

# The client has to exist before the seed imports it, and the catalogue has to
# exist before `next build` prerenders pages from it.
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run build

# A clean shutdown, so the data directory copied into the runtime image does
# not need crash recovery when the container first starts.
su postgres -c "pg_ctl -D $PGDATA -m fast -w stop"
trap - EXIT
echo "Demo image built: database seeded and the shop compiled."
