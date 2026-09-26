import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionName } from '@prisma/client';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RequestUser } from '../../modules/auth/types/request-user.type';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionName[]>(PERMISSIONS_KEY, targets);
    const anyOf = this.reflector.getAllAndOverride<PermissionName[]>(ANY_PERMISSIONS_KEY, targets);
    if ((!required || required.length === 0) && (!anyOf || anyOf.length === 0)) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user: RequestUser }>();
    const granted = new Set(user?.permissions ?? []);
    const hasAll = !required || required.every((p) => granted.has(p));
    const hasAny = !anyOf || anyOf.length === 0 || anyOf.some((p) => granted.has(p));
    if (!hasAll || !hasAny) {
      throw new ForbiddenException('Insufficient permissions to access this resource');
    }
    return true;
  }
}
