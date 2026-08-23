import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset, MediaAssetKind, MediaAssetStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { MediaVariant } from './media-keys';

/**
 * Turns a `MediaAsset` row into the URL a client is allowed to fetch, and
 * checks those URLs on the way back in.
 *
 * Two delivery regimes, because the two kinds of media have genuinely
 * different privacy properties (spec §3.2):
 *
 *  * **Partner brand media is public and immutable.** A logo is what a
 *    business puts on its own door; there is nothing to protect. The asset id
 *    is the version, so the URL for a given id never changes content and can
 *    be cached for a year. A `REPLACED` asset stays deliverable on purpose —
 *    spec §2.2 requires an old operation to keep rendering the brand it was
 *    made under, and that is literally this row.
 *
 *  * **A customer avatar is private and is delivered through a signed URL.**
 *    Not a bearer-token-protected route: the consumers are `<Image>` tags in
 *    React Native and two Next.js dashboards, none of which can attach an
 *    Authorization header to an image fetch without every call site
 *    reimplementing image loading — which is exactly what the spec's "one
 *    reusable component" rule exists to prevent. A signed URL is an
 *    authorised delivery path in the sense the spec means: the API decides,
 *    per request, whether this viewer may see this avatar, and issues a
 *    credential that says so and expires.
 *
 * The signature covers the asset, the variant, the expiry **and the viewer it
 * was issued to**. Binding the audience is the part that matters: without it,
 * a URL legitimately issued to a Level-1 referrer under consent could be
 * pasted anywhere and would keep working for everyone, which would turn a
 * consent decision about one person into a public link.
 */
@Injectable()
export class MediaDeliveryService {
  private readonly secret: Buffer;
  private readonly baseUrl: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const media = config.get('media', { infer: true });
    this.baseUrl = media.publicBaseUrl;
    this.ttlSeconds = media.signedUrlTtlSeconds;
    // Derived from the access-token secret rather than being a fourth secret
    // an operator has to remember to set. Domain-separated so a media URL
    // signature can never be replayed as anything else, and vice versa.
    const jwt = config.get('jwt', { infer: true });
    this.secret = createHmac('sha256', jwt.accessSecret).update('tutak:media-delivery:v1').digest();
  }

  /**
   * Whether this asset may be served to anyone at all without a signature.
   *
   * `REVOKED` deliberately is not: revocation is the control an administrator
   * uses when the file itself must stop being shown — a wrong logo, an
   * offensive one, one uploaded from a compromised account. A historical
   * operation whose snapshot points at a revoked asset falls back to the
   * neutral mark and keeps its snapshotted display name, which is the honest
   * outcome. Replacement, which is the ordinary case, is a different status
   * precisely so it does not have this effect.
   */
  static isPubliclyDeliverable(asset: Pick<MediaAsset, 'kind' | 'status'>): boolean {
    if (asset.kind === MediaAssetKind.USER_AVATAR) return false;
    return asset.status === MediaAssetStatus.ACTIVE || asset.status === MediaAssetStatus.REPLACED;
  }

  /** The cacheable, unsigned URL for a partner logo/cover derivative. */
  publicUrl(assetId: string, variant: MediaVariant): string {
    return `${this.baseUrl}/v1/media/brand/${assetId}/${variant}`;
  }

  /**
   * A time-limited URL for one non-public asset, issued to one viewer.
   *
   * Used for every avatar, and for a partner's own preview of a submission
   * that is still `PENDING_REVIEW` — the two cases where a specific person
   * may see an image the public may not. `audienceUserId` is that person:
   * the avatar's owner reading their own profile, a Level-1 referrer whose
   * referee has consented, a partner owner checking what they submitted, an
   * administrator working the approval queue.
   *
   * The signature is necessary but never sufficient. The delivery route
   * re-runs the full authorisation check against the database on every hit,
   * so a withdrawn consent or a removed role takes effect immediately rather
   * than whenever the URL happens to expire.
   */
  signedUrl(assetId: string, variant: MediaVariant, audienceUserId: string, now = Date.now()): string {
    const expiresAt = Math.floor(now / 1000) + this.ttlSeconds;
    const signature = this.sign(assetId, variant, audienceUserId, expiresAt);
    const query = new URLSearchParams({ aud: audienceUserId, exp: String(expiresAt), sig: signature });
    return `${this.baseUrl}/v1/media/private/${assetId}/${variant}?${query.toString()}`;
  }

  /**
   * Verifies a signed URL's query parameters.
   *
   * Returns the audience the URL was issued to, or null when the signature is
   * wrong, malformed or expired. The caller decides what to do with the
   * audience — this function makes no authorisation decision of its own, it
   * only establishes that the API really did issue this URL to that person.
   */
  verifySignature(
    assetId: string,
    variant: MediaVariant,
    query: { aud?: string; exp?: string; sig?: string },
    now = Date.now(),
  ): string | null {
    const { aud, exp, sig } = query;
    if (!aud || !exp || !sig) return null;

    const expiresAt = Number.parseInt(exp, 10);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return null;

    const expected = this.sign(assetId, variant, aud, expiresAt);
    // Constant-time, and length-checked first: `timingSafeEqual` throws on a
    // length mismatch, and an exception is itself a timing signal.
    const provided = Buffer.from(sig, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    if (provided.length !== wanted.length) return null;
    return timingSafeEqual(provided, wanted) ? aud : null;
  }

  private sign(assetId: string, variant: MediaVariant, audienceUserId: string, expiresAt: number): string {
    return createHmac('sha256', this.secret)
      // Length-prefixed rather than delimiter-joined: `a|b` and `ab|` must not
      // produce the same input, or two different (asset, audience) pairs
      // could share a signature.
      .update([assetId, variant, audienceUserId, String(expiresAt)].map((p) => `${p.length}:${p}`).join(''))
      .digest('base64url');
  }
}
