/**
 * Prisma CLI configuration.
 *
 * Replaces `package.json#prisma`, which Prisma 6 warns about on every
 * `migrate deploy` — the first line of every production boot log was that
 * warning — and which Prisma 7 removes. Only the seed command lived there.
 *
 * A config file has one side effect worth knowing: with it present, the
 * Prisma CLI no longer loads `.env` on its own. Railway and CI put
 * `DATABASE_URL` in the process environment, so they never relied on that;
 * a laptop running `prisma migrate dev` against `apps/api/.env` (written by
 * scripts/dev-setup.sh) did. `loadEnvFile` restores exactly that — the file
 * next to this one, only when it exists — without a dotenv dependency.
 */
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile(new URL('./.env', import.meta.url));
} catch {
  // No .env here: the environment already carries what Prisma needs.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
});
