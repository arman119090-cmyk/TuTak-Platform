import { ConfigService } from '@nestjs/config';
import { MediaAssetKind, MediaAssetStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { MediaDeliveryService } from './media-delivery.service';

/**
 * The URL layer, which is where a privacy decision either holds or does not.
 *
 * These are pure functions of their inputs, so they are tested as such — no
 * database, no HTTP. What the integration suite covers instead is the
 * *second* half of the rule: that the delivery route re-authorises against
 * live data on every hit, so a signature that verifies is still not enough.
 */
describe('MediaDeliveryService', () => {
  const config = {
    get: (key: string) => {
      if (key === 'media') {
        return {
          publicBaseUrl: 'https://api.example.test',
          signedUrlTtlSeconds: 3600,
        } as AppConfig['media'];
      }
      if (key === 'jwt') return { accessSecret: 'unit-test-access-secret' } as AppConfig['jwt'];
      throw new Error(`unexpected config key ${key}`);
    },
  } as unknown as ConfigService<AppConfig, true>;

  const service = new MediaDeliveryService(config);
  const parse = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

  describe('what is public', () => {
    const asset = (kind: MediaAssetKind, status: MediaAssetStatus) => ({ kind, status });

    it('serves an ACTIVE partner logo publicly', () => {
      expect(
        MediaDeliveryService.isPubliclyDeliverable(
          asset(MediaAssetKind.PARTNER_LOGO, MediaAssetStatus.ACTIVE),
        ),
      ).toBe(true);
    });

    it('keeps serving a REPLACED one — that is what makes history work', () => {
      // Spec §2.2: an operation snapshotted this asset, and replacing the
      // partner's logo must not retroactively blank out last March's receipt.
      expect(
        MediaDeliveryService.isPubliclyDeliverable(
          asset(MediaAssetKind.PARTNER_LOGO, MediaAssetStatus.REPLACED),
        ),
      ).toBe(true);
    });

    it('refuses a REVOKED one, history or not', () => {
      // The whole point of revoking rather than replacing: this file must
      // stop being shown anywhere, including on the rows that snapshotted it.
      expect(
        MediaDeliveryService.isPubliclyDeliverable(
          asset(MediaAssetKind.PARTNER_LOGO, MediaAssetStatus.REVOKED),
        ),
      ).toBe(false);
    });

    it('refuses a PENDING_REVIEW submission', () => {
      expect(
        MediaDeliveryService.isPubliclyDeliverable(
          asset(MediaAssetKind.PARTNER_LOGO, MediaAssetStatus.PENDING_REVIEW),
        ),
      ).toBe(false);
    });

    it('never treats an avatar as public, whatever its status', () => {
      for (const status of Object.values(MediaAssetStatus)) {
        expect(
          MediaDeliveryService.isPubliclyDeliverable(asset(MediaAssetKind.USER_AVATAR, status)),
        ).toBe(false);
      }
    });
  });

  describe('signed URLs', () => {
    const ASSET = 'asset-1';
    const VIEWER = 'viewer-1';

    it('round-trips a URL it issued', () => {
      const url = service.signedUrl(ASSET, 'display', VIEWER);
      expect(service.verifySignature(ASSET, 'display', parse(url))).toBe(VIEWER);
    });

    it('refuses a URL whose audience was swapped', () => {
      const url = service.signedUrl(ASSET, 'display', VIEWER);
      const query = parse(url);
      expect(service.verifySignature(ASSET, 'display', { ...query, aud: 'someone-else' })).toBeNull();
    });

    it('refuses a signature lifted onto a different asset', () => {
      const query = parse(service.signedUrl(ASSET, 'display', VIEWER));
      expect(service.verifySignature('asset-2', 'display', query)).toBeNull();
    });

    it('refuses a signature lifted onto a different variant', () => {
      const query = parse(service.signedUrl(ASSET, 'thumb', VIEWER));
      expect(service.verifySignature(ASSET, 'display', query)).toBeNull();
    });

    it('refuses an expired URL', () => {
      const issuedAt = Date.now() - 10 * 3600 * 1000;
      const query = parse(service.signedUrl(ASSET, 'display', VIEWER, issuedAt));
      expect(service.verifySignature(ASSET, 'display', query)).toBeNull();
    });

    it('refuses a URL with the expiry pushed out but the signature kept', () => {
      const query = parse(service.signedUrl(ASSET, 'display', VIEWER));
      const extended = { ...query, exp: String(Number(query.exp) + 86_400) };
      expect(service.verifySignature(ASSET, 'display', extended)).toBeNull();
    });

    it('refuses a URL with no signature at all', () => {
      expect(service.verifySignature(ASSET, 'display', {})).toBeNull();
      expect(service.verifySignature(ASSET, 'display', { aud: VIEWER, exp: '99999999999' })).toBeNull();
    });

    it('cannot be confused by concatenation of its own fields', () => {
      // Length-prefixed signing input, so ("ab","c") and ("a","bc") differ.
      const a = parse(service.signedUrl('ab', 'display', 'c'));
      const b = parse(service.signedUrl('a', 'display', 'bc'));
      expect(a.sig).not.toEqual(b.sig);
    });

    it('builds public URLs on the configured origin, with no query string', () => {
      const url = service.publicUrl(ASSET, 'thumb');
      expect(url).toBe('https://api.example.test/v1/media/brand/asset-1/thumb');
    });
  });
});
