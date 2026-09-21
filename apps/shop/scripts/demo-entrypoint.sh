#!/bin/sh
# Starts the bundled PostgreSQL, then the shop. Used only by Dockerfile.demo.
set -e

# Free hosting gives the whole container a few hundred megabytes, so the
# database is told to be modest and leave the room to Next.
su postgres -c "pg_ctl -D $PGDATA -w -o '-c listen_addresses=127.0.0.1 -c shared_buffers=32MB -c max_connections=20' start"

echo "Database up; starting the shop on port ${PORT:-10000}"
exec npx next start --port "${PORT:-10000}"
