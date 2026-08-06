#!/usr/bin/env bash
# One-command local environment bootstrap for TuTak.
#
# Brings up PostgreSQL + Redis (via Docker Compose when the daemon is
# reachable, otherwise falling back to locally-installed servers), writes the
# .env files if they are missing, then generates the Prisma client, applies
# migrations and seeds baseline data.
#
# Usage: ./scripts/dev-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_USER=tutak
PG_PASSWORD=tutak_dev_password
PG_DB=tutak
PG_PORT=5432
REDIS_PORT=6379

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[0;33m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }
die()   { printf '\033[0;31m✗ %s\033[0m\n' "$1"; exit 1; }

# ── 1. Datastores ───────────────────────────────────────────────────────
start_with_docker() {
  docker info >/dev/null 2>&1 || return 1
  info "Starting PostgreSQL + Redis via Docker Compose"
  docker compose up -d >/dev/null 2>&1 || return 1
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
      green "  ✓ Docker datastores ready"
      return 0
    fi
    sleep 1
  done
  return 1
}

start_natively() {
  info "Docker unavailable — using locally installed PostgreSQL/Redis"
  command -v pg_isready >/dev/null 2>&1 || die "PostgreSQL client not installed and Docker unreachable."

  if ! pg_isready -q -h 127.0.0.1 -p "$PG_PORT" 2>/dev/null; then
    if command -v pg_ctlcluster >/dev/null 2>&1; then
      sudo pg_ctlcluster "$(pg_lsclusters -h | awk 'NR==1{print $1}')" main start 2>/dev/null || true
    fi
  fi
  pg_isready -q -h 127.0.0.1 -p "$PG_PORT" || die "Could not start PostgreSQL on port $PG_PORT."
  green "  ✓ PostgreSQL ready on $PG_PORT"

  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    command -v redis-server >/dev/null 2>&1 || die "redis-server not installed and Docker unreachable."
    redis-server --daemonize yes --port "$REDIS_PORT" --save '' --appendonly no >/dev/null 2>&1
    sleep 1
  fi
  redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || die "Could not start Redis on port $REDIS_PORT."
  green "  ✓ Redis ready on $REDIS_PORT"

  # Ensure the role/database the app expects exist.
  info "Ensuring role '$PG_USER' and database '$PG_DB' exist"
  sudo -u postgres psql -qtA -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$PG_USER') THEN
    CREATE ROLE $PG_USER LOGIN PASSWORD '$PG_PASSWORD';
  END IF;
END \$\$;
ALTER ROLE $PG_USER CREATEDB;
SQL
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1; then
    sudo -u postgres createdb -O "$PG_USER" "$PG_DB"
  fi
  green "  ✓ Database ready"
}

start_with_docker || start_natively

# ── 2. Environment files ────────────────────────────────────────────────
info "Writing .env files (existing files are left untouched)"
for pair in "apps/api/.env.example:apps/api/.env" \
            "apps/admin/.env.example:apps/admin/.env.local" \
            "apps/partner/.env.example:apps/partner/.env.local"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  if [[ -f "$dst" ]]; then
    yellow "  • $dst already exists, skipping"
  else
    cp "$src" "$dst"
    green "  ✓ created $dst"
  fi
done

# ── 3. Database schema ──────────────────────────────────────────────────
info "Generating Prisma client"
pnpm --filter @tutak/api exec prisma generate >/dev/null
green "  ✓ Prisma client generated"

info "Applying migrations"
pnpm --filter @tutak/api exec prisma migrate deploy
green "  ✓ Migrations applied"

info "Seeding baseline data (roles, permissions, super admin)"
pnpm --filter @tutak/api exec ts-node prisma/seed.ts
green "  ✓ Seed complete"

# ── 4. Next steps ───────────────────────────────────────────────────────
cat <<'EOF'

──────────────────────────────────────────────────────────
 TuTak local environment is ready.

 Start the apps (each in its own terminal):

   pnpm --filter @tutak/api dev        # http://localhost:4000/v1  (docs: /docs)
   pnpm --filter @tutak/admin dev      # http://localhost:3000
   pnpm --filter @tutak/partner dev    # http://localhost:3001
   pnpm --filter @tutak/mobile start   # Expo — press i / a, or scan the QR

 Seeded super-admin login:
   phone:    +37400000000
   password: ChangeMe123!

 Verify the API end to end once it is running:
   ./scripts/smoke-test.sh
──────────────────────────────────────────────────────────
EOF
