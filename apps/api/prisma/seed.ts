import { PrismaClient, RoleName, PermissionName } from '@prisma/client';
import { ROLE_PERMISSIONS } from './seed-permissions';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();


async function main() {
  console.log('Seeding permissions...');
  for (const name of Object.values(PermissionName)) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log('Seeding roles...');
  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const permissions = ROLE_PERMISSIONS[roleName];
    for (const permissionName of permissions) {
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

  console.log('Seeding super admin user...');
  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.SUPER_ADMIN },
  });

  // The password must come from the environment. A literal here is committed
  // to the repository, published in the README's seed instructions, and never
  // rotated by `upsert({ update: {} })` — anyone who read the repo owned the
  // platform (docs/AUDIT_2026-08-B.md §C2).
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set to at least 12 characters before seeding. ' +
        'Generate one, store it in your secret manager, and rotate it through ' +
        'POST /v1/auth/change-password after the first login.',
    );
  }
  const passwordHash = await argon2.hash(adminPassword);
  const admin = await prisma.user.upsert({
    where: { phone: '+37400000000' },
    update: {},
    create: {
      phone: '+37400000000',
      email: 'admin@tutak.am',
      passwordHash,
      firstName: 'TuTak',
      lastName: 'Admin',
      locale: 'hy',
      isPhoneVerified: true,
      // Forces rotation at first login: the seeded credential is only ever a
      // bootstrap, never a working operator password.
      mustChangePassword: true,
      wallet: { create: {} },
    },
  });

  // Every user needs a referral code; only register() created one, so the
  // seeded admin used to 500 on GET /referral/me/code (§M2).
  await prisma.referralCode.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id, code: `TT-${randomBytes(5).toString('hex').toUpperCase()}` },
  });

  // A global (unscoped) role has partnerId = NULL. Postgres treats NULLs as
  // distinct in a unique index and Prisma rejects null inside a compound
  // unique lookup, so upsert-by-compound-key can't be used here — find then
  // create instead.
  const existingAdminRole = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: superAdminRole.id, partnerId: null },
  });
  if (!existingAdminRole) {
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: superAdminRole.id },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
