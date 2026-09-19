import {
  adminPermissionSchema,
  adminRoleSchema,
  permissionsFor,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from '../src/dto/admin';

describe('admin RBAC', () => {
  it('grants only declared permissions', () => {
    const known = new Set(adminPermissionSchema.options);
    for (const role of adminRoleSchema.options) {
      for (const permission of permissionsFor(role)) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('never grants the same permission twice in one role', () => {
    for (const role of adminRoleSchema.options) {
      const permissions = permissionsFor(role);
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });

  it('keeps a viewer strictly read-only', () => {
    for (const permission of permissionsFor('VIEWER')) {
      expect(permission.endsWith(':read')).toBe(true);
    }
  });

  it('does not let an operator move money or change pricing', () => {
    expect(roleHasPermission('OPERATOR', 'ledger:adjust')).toBe(false);
    expect(roleHasPermission('OPERATOR', 'fees:write')).toBe(false);
    expect(roleHasPermission('OPERATOR', 'limits:write')).toBe(false);
    expect(roleHasPermission('OPERATOR', 'admins:write')).toBe(false);
  });

  it('does not let finance create admins', () => {
    expect(roleHasPermission('FINANCE', 'admins:write')).toBe(false);
  });

  it('reserves user administration for ADMIN alone', () => {
    const holders = adminRoleSchema.options.filter((role) =>
      roleHasPermission(role, 'admins:write'),
    );
    expect(holders).toEqual(['ADMIN']);
  });

  it('gives ADMIN every declared permission', () => {
    expect(new Set(ROLE_PERMISSIONS.ADMIN)).toEqual(new Set(adminPermissionSchema.options));
  });

  it('lets every role at least read the dashboard', () => {
    for (const role of adminRoleSchema.options) {
      expect(roleHasPermission(role, 'dashboard:read')).toBe(true);
    }
  });
});
