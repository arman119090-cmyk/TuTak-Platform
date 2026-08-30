/**
 * The minimum a deployment needs to function: every permission, every role
 * with its grants, and one temporary super admin.
 *
 * This baseline intentionally creates no partner, wallet, referral code,
 * purchase, discount, payment, settlement or other business record. The
 * administrator is bootstrap-only and is created with mustChangePassword.
 *
 * Idempotent: every write is an upsert or a find-then-create, and an
 * existing admin's password is deliberately left alone.
 */
import { PrismaClient, RoleName, PermissionName } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_PERMISSIONS } from './role-permissions';

export async function seedBaseline(prisma: PrismaClient): Promise<void> {
  console.log('Seeding permissions...');
  for (const name of Object.values(PermissionName)) {
    await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log('Seeding roles...');
  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionName of ROLE_PERMISSIONS[roleName]) {
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

  console.log('Seeding temporary super admin user...');
  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.SUPER_ADMIN },
  });

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
      mustChangePassword: true,
    },
  });

  const existingAdminRole = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: superAdminRole.id, partnerId: null },
  });
  if (!existingAdminRole) {
    await prisma.userRole.create({ data: { userId: admin.id, roleId: superAdminRole.id } });
  }

  console.log('Baseline seed complete. Disable SEED_BASELINE after the first successful login and password rotation.');
}

/** Entry point when run directly: `node dist/scripts/seed-baseline.js`. */
if (require.main === module) {
  const prisma = new PrismaClient();
  seedBaseline(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
