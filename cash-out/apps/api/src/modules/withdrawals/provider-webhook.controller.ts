import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.guard';
import { ProviderWebhookService } from './provider-webhook.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Controller('v1/webhooks')
export class ProviderWebhookController {
  constructor(private readonly webhooks: ProviderWebhookService) {}

  /**
   * Public by necessity — the provider cannot present a driver token — and
   * therefore authenticated by signature instead. The raw body is used, not the
   * parsed one.
   */
  @Public()
  @Post('payment-provider')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const raw = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    return this.webhooks.handle(raw, headers);
  }
}
