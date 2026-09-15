import type { PrismaClient } from '@prisma/client';
import { seedBaseline } from './seed-baseline';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('argon2-hash'),
}));

describe('seedBaseline', () => {
  const permissionUpsert = jest.fn().mockImplementation(({ create }) =>
    Promise.resolve({ id: `permission:${create.name}`, name: create.name }),
  );
  const permissionFindUniqueOrThrow = jest.fn().mockImplementation(({ where }) =>
    Promise.resolve({ id: `permission:${where.name}`, name: where.name }),
  );
  const roleUpsert = jest.fn().mockImplementation(({ create }) =>
    Promise.resolve({ id: `role:${create.name}`, name: create.name }),
  );
  const roleFindUniqueOrThrow = jest.fn().mockResolvedValue({
    id: 'role:SUPER_ADMIN',
    name: 'SUPER_ADMIN',
  });
  const rolePermissionUpsert = jest.fn().mockResolvedValue({});
  const userUpsert = jest.fn().mockResolvedValue({ id: 'admin-id' });
  const userRoleFindFirst = jest.fn().mockResolvedValue(null);
  const userRoleCreate = jest.fn().mockResolvedValue({});

  const allowedDelegates = {
    permission: {
      upsert: permissionUpsert,
      findUniqueOrThrow: permissionFindUniqueOrThrow,
    },
    role: {
      upsert: roleUpsert,
      findUniqueOrThrow: roleFindUniqueOrThrow,
    },
    rolePermission: { upsert: rolePermissionUpsert },
    user: { upsert: userUpsert },
    userRole: {
      findFirst: userRoleFindFirst,
      create: userRoleCreate,
    },
  };

  const prisma = new Proxy(allowedDelegates, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(`seedBaseline touched forbidden Prisma delegate: ${String(property)}`);
    },
  }) as unknown as PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SEED_ADMIN_PASSWORD = 'temporary-password-123';
  });

  afterEach(() => {
    delete process.env.SEED_ADMIN_PASSWORD;
  });

  it('touches only access-control tables and the temporary administrator', async () => {
    await seedBaseline(prisma);

    expect(permissionUpsert).toHaveBeenCalled();
    expect(roleUpsert).toHaveBeenCalled();
    expect(rolePermissionUpsert).toHaveBeenCalled();
    expect(userUpsert).toHaveBeenCalledTimes(1);
    expect(userRoleFindFirst).toHaveBeenCalledTimes(1);
    expect(userRoleCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create wallet, referral or any nested business data for the admin', async () => {
    await seedBaseline(prisma);

    const call = userUpsert.mock.calls[0]![0];
    expect(call.create.mustChangePassword).toBe(true);
    expect(call.create.wallet).toBeUndefined();
    expect(call.create.referralCode).toBeUndefined();
    expect(call.create.partner).toBeUndefined();
    expect(call.create.purchases).toBeUndefined();
    expect(call.create.discounts).toBeUndefined();
    expect(call.create.payments).toBeUndefined();
  });
});
