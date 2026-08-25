import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PartnerApiKeyService } from './partner-api-key.service';

/**
 * M2M auth for the FastCharge inbound webhook routes
 * (`FastChargeController`). Every one of those routes is `@Public()` (no
 * TuTak user session — FastCharge is a machine, not a logged-in customer)
 * and relies on this guard instead, per requirement 3 — "separate
 * machine-to-machine API credentials, not a human login/password".
 *
 * Stamps `request.fastChargePartnerId` for `@FastChargePartner()` to read —
 * same "guard resolves identity, decorator reads it" shape
 * `JwtAuthGuard`/`@CurrentUser()` already use for human sessions.
 */
@Injectable()
export class FastChargeApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: PartnerApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      fastChargePartnerId?: string;
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

    request.fastChargePartnerId = verified.partnerId;
    return true;
  }
}
