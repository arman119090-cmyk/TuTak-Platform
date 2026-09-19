import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/app-error';
import { requestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';

export const IS_PUBLIC = 'cashout:isPublic';
/** Marks an endpoint as reachable without a driver token. Used sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    sessionId: string;
    deviceId: string;
    driverId: string | null;
  };
}

/**
 * The default for every driver-facing route.
 *
 * Registered globally so that a new controller is protected unless someone
 * deliberately marks it `@Public()`. Forgetting to add a guard is a much more
 * common mistake than forgetting to remove one.
 */
@Injectable()
export class DriverAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    }

    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    const driver = await this.prisma.driver.findUnique({
      where: { userId: claims.sub },
      select: { id: true },
    });

    request.auth = {
      userId: claims.sub,
      sessionId: claims.sid,
      deviceId: claims.did,
      driverId: driver?.id ?? null,
    };

    requestContext.set('userId', claims.sub);
    requestContext.set('driverId', driver?.id);

    return true;
  }
}
