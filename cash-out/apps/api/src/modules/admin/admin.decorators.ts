import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { AdminRequest } from './admin.guard';

export const CurrentAdmin = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AdminRequest>();
  if (!request.admin) {
    throw new AppError('UNAUTHENTICATED', 'No admin on this request');
  }
  return request.admin;
});
