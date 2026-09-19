import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { AuthenticatedRequest } from './auth.guard';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) {
    throw new AppError('UNAUTHENTICATED', 'No authenticated user on this request');
  }
  return request.auth;
});

/**
 * Resolves the driver id, refusing the request when the account has no driver
 * record. Every money endpoint takes this rather than a user id, so a
 * half-registered account cannot reach the withdrawal path at all.
 */
export const CurrentDriverId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth?.driverId) {
    throw new AppError('DRIVER_NOT_VERIFIED', 'This account has no driver profile yet');
  }
  return request.auth.driverId;
});
