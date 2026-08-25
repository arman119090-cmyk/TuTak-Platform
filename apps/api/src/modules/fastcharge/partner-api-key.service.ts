import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Machine-to-machine credentials for a `PartnerIntegration` — requirement 3
 * of docs/FASTCHARGE_INTEGRATION_2026-08-25.md: "owned by their TuTak
 * partner account and use separate M2M API credentials, not a human
 * login/password". Built on `PartnerApiKey`, hung off the existing
 * `PartnerIntegration`/`PartnerIntegrationType.API` extension point — no
 * parallel auth system.
 *
 * Standard "public id + secret, only the hash stored" API-key shape: the
 * caller sends `x-api-key: <keyId>.<secret>`, `FastChargeApiKeyGuard` looks
 * up the row by `keyId` (indexed, O(1)) and only then hashes and compares
 * the secret — so a lookup never has to scan and compare every row's hash,
 * and the plaintext secret is never stored anywhere after `issue` returns.
 */
@Injectable()
export class PartnerApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the plaintext secret exactly once — the caller must hand it to the partner now; it is never recoverable again. */
  async issue(params: { partnerId: string; integrationId?: string; label?: string }) {
    const keyId = randomBytes(12).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const keyHash = PartnerApiKeyService.hash(secret);

    const row = await this.prisma.partnerApiKey.create({
      data: {
        partnerId: params.partnerId,
        integrationId: params.integrationId,
        keyId,
        keyHash,
        label: params.label,
      },
    });

    return { id: row.id, keyId, apiKey: `${keyId}.${secret}`, createdAt: row.createdAt };
  }

  async revoke(id: string, partnerId: string) {
    const result = await this.prisma.partnerApiKey.updateMany({
      where: { id, partnerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async list(partnerId: string) {
    return this.prisma.partnerApiKey.findMany({
      where: { partnerId },
      select: {
        id: true,
        keyId: true,
        label: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Verifies a raw `x-api-key` header value and returns the owning partner id, or null. */
  async verify(rawApiKey: string): Promise<{ partnerId: string; apiKeyId: string } | null> {
    const separator = rawApiKey.indexOf('.');
    if (separator <= 0) return null;
    const keyId = rawApiKey.slice(0, separator);
    const secret = rawApiKey.slice(separator + 1);
    if (!secret) return null;

    const row = await this.prisma.partnerApiKey.findUnique({ where: { keyId } });
    if (!row || row.revokedAt) return null;
    // Timing-safe: a plain `!==` leaks how many leading bytes of the hash
    // matched through response-time variance, which is exactly the kind of
    // oracle an API-key secret must not have.
    const expected = Buffer.from(row.keyHash, 'hex');
    const actual = Buffer.from(PartnerApiKeyService.hash(secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    // Best-effort — a lost update here must never block the caller's real request.
    this.prisma.partnerApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return { partnerId: row.partnerId, apiKeyId: row.id };
  }

  static hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}
