# Off-Railway, encrypted copy of the production database.
#
# Runs INSIDE the Railway project (private network → no public Postgres), as
# its own service with a cron schedule, and ships an age-encrypted pg_dump to
# an S3-compatible bucket that is NOT Railway (Backblaze B2, Cloudflare R2,
# Hetzner, AWS…). That is the one copy that survives losing the Railway
# project or account. Nothing here is enabled until the service exists and
# its variables are set — see infra/offsite-backup/README.md.
FROM postgres:18-alpine
RUN apk add --no-cache age aws-cli bash coreutils
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh
ENTRYPOINT ["/backup.sh"]
