import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionName } from '@prisma/client';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RequestUser } from '../../modules/auth/types/request-user.type';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionName[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user: RequestUser }>();
    const granted = new Set(user?.permissions ?? []);
    const hasAll = required.every((p) => granted.has(p));
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions to access this resource');
    }
    return true;
  }
}
