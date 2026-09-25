import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PartnerApiKeyService } from '../partners/partner-api-key.service';

/**
 * M2M auth for `POST /partner-orders` — a partner's own website backend,
 * never a browser (spec §3: "не хранить секреты во frontend"). Same shape
 * as `RoamingCpoApiKeyGuard`: an `x-api-key: <keyId>.<secret>` bearer,
 * verified via the shared `PartnerApiKeyService`, stamping the request with
 * who it was rather than trusting a body field. The key must additionally
 * be scoped to a `PartnerIntegration` — a bare, integration-less key (the
 * shape roaming-CPO issues) is refused here; `PartnerOrdersService.create`
 * does the remaining check (that integration is actually `WEBSITE` and
 * `ACTIVE`), since only it knows what "valid for order creation" means.
 */
@Injectable()
export class PartnerOrderApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: PartnerApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      partnerOrderPartnerId?: string;
      partnerOrderIntegrationId?: string;
    }>();
    const header = request.headers['x-api-key'];
    const rawApiKey = Array.isArray(header) ? header[0] : header;
    if (!rawApiKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const verified = await this.apiKeys.verify(rawApiKey);
    if (!verified) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }
    if (!verified.integrationId) {
      throw new ForbiddenException('This API key is not scoped to a partner integration');
    }

    request.partnerOrderPartnerId = verified.partnerId;
    request.partnerOrderIntegrationId = verified.integrationId;
    return true;
  }
}
