/**
 * One-command setup: `npm run setup`.
 *
 * Checks the environment, creates .env from the template when it is missing,
 * applies migrations and seeds the demo data — so a first run needs exactly one
 * command plus a PostgreSQL connection string.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = process.cwd();
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

const run = (command: string): void => {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: 'inherit', cwd: root });
};

const fail = (message: string): never => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

console.log('\nORNATA demo — setup\n');

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) fail('.env.example is missing — cannot create .env.');
  copyFileSync(examplePath, envPath);
  console.log('• created .env from .env.example');
  console.log('  Edit DATABASE_URL if your PostgreSQL is not on localhost:5432, then re-run.');
}

/*
 * Every install gets its own signing secret. The placeholder in .env.example
 * exists so the file reads clearly; leaving it in place would mean every copy
 * of this demo shared one secret, and the app refuses it in production anyway.
 */
const withSecret = readFileSync(envPath, 'utf8');
if (/AUTH_SECRET="?demo-only-secret/.test(withSecret)) {
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(envPath, withSecret.replace(/AUTH_SECRET="[^"]*"/, `AUTH_SECRET="${secret}"`));
  console.log('• generated a unique AUTH_SECRET for this installation');
}

const env = readFileSync(envPath, 'utf8');
const databaseUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!databaseUrl) fail('DATABASE_URL is not set in .env');
console.log(`• database: ${databaseUrl!.replace(/:[^:@/]+@/, ':***@')}`);

run('npx prisma generate');
run('npx prisma migrate deploy');
run('npx tsx prisma/seed.ts');

console.log(`
Setup complete.

  npm run dev      → http://localhost:3100

  Customer: demo@furniture.local / demo1234
  Admin:    admin@furniture.local / admin1234  → /admin
`);
