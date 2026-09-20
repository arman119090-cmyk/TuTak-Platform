#!/usr/bin/env bash
# pg_dump → age (public-key) → S3-compatible bucket. One run = one object.
# Required variables on the Railway service:
#   DATABASE_URL           reference ${{Postgres.DATABASE_URL}} (private network)
#   BACKUP_AGE_RECIPIENT   an `age` PUBLIC key (age1…); the private key stays off Railway
#   OFFSITE_S3_ENDPOINT    e.g. https://s3.eu-central-003.backblazeb2.com
#   OFFSITE_S3_BUCKET      bucket name (versioning + lifecycle 35 days recommended)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   a key that can ONLY put objects (no delete/list)
# Optional: OFFSITE_S3_REGION (default us-east-1), OFFSITE_PREFIX (default tutak)
set -euo pipefail
: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${OFFSITE_S3_ENDPOINT:?}" "${OFFSITE_S3_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION="${OFFSITE_S3_REGION:-us-east-1}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
key="${OFFSITE_PREFIX:-tutak}/tutak-${stamp}.dump.age"
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
echo "dumping…"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > "$tmp"
size=$(stat -c %s "$tmp")
[ "$size" -gt 10000 ] || { echo "dump is only ${size} bytes — refusing to upload something that small"; exit 1; }
echo "uploading ${size} bytes to s3://${OFFSITE_S3_BUCKET}/${key}"
aws --endpoint-url "$OFFSITE_S3_ENDPOINT" s3 cp "$tmp" "s3://${OFFSITE_S3_BUCKET}/${key}" --only-show-errors
# Prove it landed: head the object (a put-only key may not be allowed to list; head is usually allowed).
aws --endpoint-url "$OFFSITE_S3_ENDPOINT" s3api head-object --bucket "$OFFSITE_S3_BUCKET" --key "$key" >/dev/null
echo "OFFSITE BACKUP OK ${key} ${size}B"
