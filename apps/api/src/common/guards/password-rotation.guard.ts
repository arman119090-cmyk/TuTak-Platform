import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOWS_PENDING_PASSWORD_CHANGE } from '../decorators/allow-pending-password-change.decorator';
import { RequestUser } from '../../modules/auth/types/request-user.type';

/**
 * Enforces forced password rotation.
 *
 * The seeded super-admin credential is a bootstrap, not an operator password:
 * it exists only so someone can log in once and replace it. This guard is what
 * makes that true — with `mustChangePassword` set, the account can reach
 * change-password and logout and nothing else, so a leaked bootstrap
 * credential cannot be used to run the platform (docs/AUDIT_2026-08-B.md §C2).
 */
@Injectable()
export class PasswordRotationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWS_PENDING_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (user?.mustChangePassword) {
      throw new ForbiddenException(
        'Your password must be changed before you can use this account',
      );
    }
    return true;
  }
}
