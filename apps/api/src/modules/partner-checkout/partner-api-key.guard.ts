import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PartnerApiKeyService } from '../roaming-cpo/partner-api-key.service';

export interface PartnerApiIdentity {
  partnerId: string;
  apiKeyId: string;
  /** The integration the key was issued for; null for a partner-wide key, which the POS routes refuse. */
  integrationId: string | null;
}

/**
 * M2M auth for the partner checkout (POS) routes — the same `x-api-key`
 * mechanism and the same `PartnerApiKeyService` as `RoamingCpoApiKeyGuard`,
 * kept as its own guard so the identity it stamps carries the key id as
 * well as the partner: a checkout records *which* credential opened it.
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: PartnerApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; partnerApi?: PartnerApiIdentity }>();
    const header = request.headers['x-api-key'];
    const rawApiKey = Array.isArray(header) ? header[0] : header;
    if (!rawApiKey) throw new UnauthorizedException('Missing x-api-key header');

    const verified = await this.apiKeys.verify(rawApiKey);
    if (!verified) throw new UnauthorizedException('Invalid or revoked API key');

    request.partnerApi = {
      partnerId: verified.partnerId,
      apiKeyId: verified.apiKeyId,
      integrationId: verified.integrationId,
    };
    return true;
  }
}

/** The identity `PartnerApiKeyGuard` resolved from the `x-api-key` header. */
export const PartnerApi = createParamDecorator((_data: unknown, ctx: ExecutionContext): PartnerApiIdentity => {
  const request = ctx.switchToHttp().getRequest<{ partnerApi: PartnerApiIdentity }>();
  return request.partnerApi;
});
