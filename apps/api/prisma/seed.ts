import { PrismaClient, RoleName, PermissionName } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ROLE_PERMISSIONS: Record<RoleName, PermissionName[]> = {
  CUSTOMER: [PermissionName.WALLET_READ, PermissionName.QR_REDEEM],
  PARTNER_STAFF: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
  ],
  PARTNER_OWNER: [
    PermissionName.QR_ISSUE,
    PermissionName.PARTNER_TRANSACTIONS_READ,
    PermissionName.PARTNER_MANAGE,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
  ],
  ADMIN: [
    PermissionName.USER_MANAGE,
    PermissionName.PARTNER_MANAGE,
    PermissionName.BONUS_RULE_MANAGE,
    PermissionName.ADMIN_AUDIT_READ,
    PermissionName.EV_STATION_MANAGE,
    PermissionName.ANALYTICS_READ,
    PermissionName.WALLET_WRITE,
  ],
  SUPER_ADMIN: Object.values(PermissionName),
};

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

  const passwordHash = await argon2.hash('ChangeMe123!');
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
      wallet: { create: {} },
    },
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
