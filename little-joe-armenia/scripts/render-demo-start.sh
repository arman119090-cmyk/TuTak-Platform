#!/bin/sh
# Starts an in-container PostgreSQL, migrates, seeds the demo catalog and
# runs Next.js. Used only by Dockerfile.render-demo (ephemeral demo).
set -eu
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
PGDATA=${PGDATA_DIR:-/tmp/pgdata}
PGPORT=${PGPORT:-5432}
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
  su postgres -s /bin/sh -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres >/dev/null"
fi
# Small memory footprint for the 512 MB free instance.
su postgres -s /bin/sh -c "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/server.log -w -o '-c listen_addresses=127.0.0.1 -p $PGPORT -c shared_buffers=32MB -c max_connections=30 -k /tmp' start"
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='lj'" | grep -q 1 || psql -h 127.0.0.1 -p "$PGPORT" -U postgres -c "CREATE DATABASE lj" >/dev/null
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/lj"
export SEED_DEMO=true
node_modules/.bin/prisma migrate deploy
node_modules/.bin/tsx prisma/seed.ts
exec node_modules/.bin/next start -p "${PORT:-10000}"
