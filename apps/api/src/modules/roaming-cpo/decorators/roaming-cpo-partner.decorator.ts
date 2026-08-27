import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The partner id `RoamingCpoApiKeyGuard` resolved from the `x-api-key` header. */
export const RoamingCpoPartner = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ roamingCpoPartnerId: string }>();
  return request.roamingCpoPartnerId;
});
