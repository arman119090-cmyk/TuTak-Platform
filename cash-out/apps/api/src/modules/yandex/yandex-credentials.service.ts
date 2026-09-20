import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { YandexUnavailableError } from './yandex.port';

export interface YandexCredential {
  readonly clientId: string;
  readonly apiKey: string;
  /** Where the credential came from, for the integration tile. */
  readonly source: 'PARK' | 'ENV';
}

/**
 * Which Fleet API key a call for a given park uses.
 *
 * Multi-park is the normal case: every park has its own Client-ID and API key,
 * stored encrypted on its `ParkIntegrationCredential` row. The process-wide
 * `YANDEX_CLIENT_ID` / `YANDEX_API_KEY` pair remains only as a fallback for a
 * single-park deployment whose `YANDEX_PARK_ID` matches — never as a key that
 * silently serves every park.
 */
@Injectable()
export class YandexCredentialsResolver {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async forPark(yandexParkId: string): Promise<YandexCredential> {
    const park = await this.prisma.park.findUnique({
      where: { yandexParkId },
      include: { credential: true },
    });
    if (park?.credential) {
      return {
        clientId: park.credential.clientId,
        apiKey: this.crypto.decrypt(park.credential.apiKeyEnc),
        source: 'PARK',
      };
    }
    if (
      this.env.YANDEX_CLIENT_ID &&
      this.env.YANDEX_API_KEY &&
      (!this.env.YANDEX_PARK_ID || this.env.YANDEX_PARK_ID === yandexParkId)
    ) {
      return {
        clientId: this.env.YANDEX_CLIENT_ID,
        apiKey: this.env.YANDEX_API_KEY,
        source: 'ENV',
      };
    }
    throw new YandexUnavailableError(
      `No Fleet API credential is configured for park ${yandexParkId}`,
    );
  }
}
