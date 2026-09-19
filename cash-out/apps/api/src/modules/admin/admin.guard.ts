import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdminPermission, roleHasPermission } from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { requestContext } from '../../common/request-context';
import { AdminAuthService } from './admin-auth.service';

export const REQUIRED_PERMISSION = 'cashout:adminPermission';

/** Declares what an admin endpoint needs. Absence of this is itself an error. */
export const RequirePermission = (permission: AdminPermission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export interface AdminRequest extends Request {
  admin?: { id: string; email: string; role: string; sessionId: string };
}

/**
 * Admin authentication and authorisation.
 *
 * An endpoint without a `@RequirePermission` is refused rather than allowed.
 * Fail-closed is the only sane default for a panel that can move money, and it
 * turns "someone forgot the decorator" into a 403 in review instead of an open
 * door in production.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Missing admin token');
    }

    const { admin, sessionId } = await this.auth.verifySessionToken(
      header.slice('Bearer '.length).trim(),
    );

    request.admin = { id: admin.id, email: admin.email, role: admin.role, sessionId };
    requestContext.set('adminUserId', admin.id);

    const required = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      throw AppError.forbidden('This endpoint declares no required permission');
    }
    if (!roleHasPermission(admin.role, required)) {
      throw AppError.forbidden(`Role ${admin.role} lacks ${required}`);
    }

    return true;
  }
}
