import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL, databaseName, maintenanceUrl } from './test-database';

const apiRoot = path.resolve(__dirname, '../..');

/**
 * Prepares a real PostgreSQL database for the integration suite.
 *
 * Creates it if absent, applies the migration history exactly as production
 * would, and then does something a fresh database uniquely allows: validates
 * `bonus_ledger_delta_matches_direction`.
 *
 * That constraint ships NOT VALID because the development database still
 * holds ledger rows written before the delta columns existed. A database
 * created from scratch has no such rows, so running VALIDATE here proves the
 * invariant holds for every row the current code can produce — if any code
 * path ever writes an entry whose deltas contradict its direction, this fails
 * before a single test runs.
 */
export default async function globalSetup() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  await ensureDatabaseExists();

  execFileSync('node', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "bonus_ledger_entries" VALIDATE CONSTRAINT "bonus_ledger_delta_matches_direction"',
    );
    await seedRolesAndPermissions(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureDatabaseExists() {
  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName()}"`);
  } catch (err) {
    // 42P01/42P04 — already there. Anything else is a real connection problem
    // and must not be swallowed, or every test fails with a confusing error.
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(message)) throw err;
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Roles and permissions are reference data, not fixtures: they are seeded
 * once and preserved by the per-test truncation so that services resolving
 * `RoleName.CUSTOMER` behave as they do in production.
 */
async function seedRolesAndPermissions(prisma: PrismaClient) {
  const { PermissionName, RoleName } = await import('@prisma/client');

  for (const name of Object.values(PermissionName)) {
    await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    // Every permission on every role: the integration suite tests money
    // correctness, not authorisation, and the guards are exercised separately.
    for (const permissionName of Object.values(PermissionName)) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { name: permissionName },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}
