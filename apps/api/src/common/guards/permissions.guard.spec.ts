import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionName } from '@prisma/client';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

function contextFor(permissions: PermissionName[], meta: { all?: PermissionName[]; any?: PermissionName[] }) {
  const handler = () => undefined;
  if (meta.all) Reflect.defineMetadata(PERMISSIONS_KEY, meta.all, handler);
  if (meta.any) Reflect.defineMetadata(ANY_PERMISSIONS_KEY, meta.any, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as never;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('requires every permission of @RequirePermissions', () => {
    const meta = { all: [PermissionName.PURCHASE_INTENT_CONFIRM, PermissionName.PARTNER_MANAGE] };
    expect(guard.canActivate(contextFor([PermissionName.PURCHASE_INTENT_CONFIRM, PermissionName.PARTNER_MANAGE], meta))).toBe(true);
    expect(() => guard.canActivate(contextFor([PermissionName.PURCHASE_INTENT_CONFIRM], meta))).toThrow(ForbiddenException);
  });

  it('item 10: @RequireAnyPermission lets through a holder of any one — e.g. shifts for PARTNER_ORDER_MANAGE only', () => {
    const meta = { any: [PermissionName.PURCHASE_INTENT_CONFIRM, PermissionName.PARTNER_ORDER_MANAGE] };
    expect(guard.canActivate(contextFor([PermissionName.PARTNER_ORDER_MANAGE], meta))).toBe(true);
    expect(guard.canActivate(contextFor([PermissionName.PURCHASE_INTENT_CONFIRM], meta))).toBe(true);
    expect(() => guard.canActivate(contextFor([PermissionName.PARTNER_TRANSACTIONS_READ], meta))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor([], meta))).toThrow(ForbiddenException);
  });

  it('passes a route with no permission metadata', () => {
    expect(guard.canActivate(contextFor([], {}))).toBe(true);
  });
});
