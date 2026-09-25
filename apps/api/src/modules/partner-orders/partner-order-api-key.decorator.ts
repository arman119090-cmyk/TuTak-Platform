import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface PartnerOrderApiKeyRequest {
  partnerOrderPartnerId: string;
  partnerOrderIntegrationId: string;
}

/** The partner id `PartnerOrderApiKeyGuard` resolved from the `x-api-key` header. */
export const PartnerOrderApiKeyPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<PartnerOrderApiKeyRequest>().partnerOrderPartnerId,
);

/** The `PartnerIntegration` id the verified API key is scoped to. */
export const PartnerOrderApiKeyIntegration = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<PartnerOrderApiKeyRequest>().partnerOrderIntegrationId,
);
