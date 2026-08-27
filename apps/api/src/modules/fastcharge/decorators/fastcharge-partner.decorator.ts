import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The partner id `FastChargeApiKeyGuard` resolved from the `x-api-key` header. */
export const FastChargePartner = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ fastChargePartnerId: string }>();
  return request.fastChargePartnerId;
});
