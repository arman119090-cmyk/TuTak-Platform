import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MediaAssetKind, MediaAssetStatus } from '@prisma/client';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { MediaDeliveryService } from '../../infrastructure/media/media-delivery.service';
import { isMediaVariant, MediaVariant } from '../../infrastructure/media/media-keys';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from './media.service';

/**
 * The only way bytes leave media storage.
 *
 * There is no static file mount and no direct bucket access, for either
 * driver — spec §3.2's last non-goal is "no direct browser/mobile write access
 * to a storage bucket without server-side authorisation", and the read side
 * deserves the same treatment for avatars. Every request lands here, and here
 * is where the question "may *this* requester see *this* image" gets answered.
 *
 * Both routes are `@Public()` in the Nest sense — no bearer token — which is
 * not the same as unauthenticated. `/brand` genuinely is public: a logo is
 * what a business puts on its own door. `/private` carries its own credential
 * in the URL and is re-authorised against the database on every single hit,
 * so it is strictly *more* responsive to a revoked permission than a bearer
 * token would be: a 15-minute access token keeps working after consent is
 * withdrawn, and this does not.
 */
/**
 * The headers every media response carries.
 *
 * `Cross-Origin-Resource-Policy: cross-origin` is the load-bearing one, and it
 * exists because of a bug this codebase actually shipped into a screenshot
 * before anyone noticed. `helmet()` defaults CORP to `same-origin`, which is
 * the right default for an API that returns JSON to its own front end — and
 * exactly wrong for one that serves images embedded by three separate
 * origins. Every single partner logo and customer avatar was being fetched
 * successfully and then discarded by the browser, so every surface fell back
 * to the neutral mark and looked, convincingly, like a feature that had not
 * been wired up. Found by looking at a screenshot, not by reading the code.
 *
 * Relaxing CORP here gives away nothing. CORP governs *embedding*, not
 * reading: a page that embeds one of these URLs still cannot read the pixels
 * back without CORS, which this API does not grant for these routes. The
 * brand route is public by design anyway, and the private route's protection
 * is its signature plus a fresh authorisation check on every hit — neither of
 * which CORP was contributing to.
 *
 * The other two are unchanged: `nosniff` so a mislabelled or hostile file that
 * somehow got stored cannot be reinterpreted as a document, and a `sandbox`
 * CSP so that even if it were, it executes nothing.
 */
function applyImageHeaders(res: Response): void {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
}

@ApiTags('media')
@Controller('media')
export class MediaDeliveryController {
  constructor(
    private readonly media: MediaService,
    private readonly delivery: MediaDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * A partner logo or cover derivative.
   *
   * Cached hard and forever. The asset id *is* the version — a partner
   * replacing its logo mints a new id and every DTO starts returning that one
   * — so the bytes behind a given URL genuinely never change and there is
   * nothing for a cache to get wrong. Spec §3.2: "Public partner-logo
   * derivatives may be cached as immutable versioned assets."
   */
  @Public()
  @Get('brand/:assetId/:variant')
  async brand(
    @UuidParam('assetId') assetId: string,
    @Param('variant') variant: string,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = this.parseVariant(variant);
    const asset = await this.media.findAsset(assetId);
    if (!asset || !MediaDeliveryService.isPubliclyDeliverable(asset)) {
      // One 404 for "no such asset", "that is an avatar" and "that logo was
      // revoked". A public endpoint should not be a probe for which asset ids
      // exist or what state somebody else's brand is in.
      throw new NotFoundException('Image not found');
    }
    const object = await this.media.readVariant(asset, parsed);
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    applyImageHeaders(res);
    res.end(object.body);
  }

  /**
   * A derivative that is not public: any avatar, or a partner submission that
   * has not been approved.
   *
   * Two independent checks, both required:
   *
   *  1. the URL's HMAC must verify, which establishes that this API issued it
   *     and names the person it was issued to;
   *  2. that person must *still* be allowed to see this asset, checked against
   *     the database now rather than when the URL was minted.
   *
   * The second check is the one that matters. Without it, a consent withdrawal
   * or a revoked partner role would not take effect until every URL already
   * issued had expired — up to twelve hours of a decision the customer
   * believes they already made.
   */
  @Public()
  @Get('private/:assetId/:variant')
  async private(
    @UuidParam('assetId') assetId: string,
    @Param('variant') variant: string,
    @Query('aud') aud: string | undefined,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = this.parseVariant(variant);
    const audience = this.delivery.verifySignature(assetId, parsed, { aud, exp, sig });
    if (!audience) {
      throw new ForbiddenException('This image link is invalid or has expired');
    }

    const asset = await this.media.findAsset(assetId);
    if (!asset) throw new NotFoundException('Image not found');
    if (!(await this.mayStillView(asset, audience))) {
      throw new ForbiddenException('You are not allowed to view this image');
    }

    const object = await this.media.readVariant(asset, parsed);
    res.setHeader('Content-Type', object.contentType);
    // Private, and short — the URL expires anyway, but a shared cache holding
    // one customer's face keyed by a URL another customer could be handed is
    // not a risk worth taking for a few kilobytes.
    res.setHeader('Cache-Control', 'private, max-age=300');
    applyImageHeaders(res);
    res.end(object.body);
  }

  /**
   * Spec §1.4, enforced here for real rather than only at DTO-assembly time.
   *
   * An avatar may be seen by its owner, and by the person who directly invited
   * them *if* they have consented. That is the complete list: not Level 2, not
   * Level 3, not a partner whose till they walked up to, not an administrator.
   * A partner's unapproved submission may be seen by that partner's own people
   * and by a platform administrator, which is what makes an approval queue
   * possible without publishing what is in it.
   */
  private async mayStillView(
    asset: { id: string; kind: MediaAssetKind; status: MediaAssetStatus; userId: string | null; partnerId: string | null },
    viewerId: string,
  ): Promise<boolean> {
    if (asset.kind === MediaAssetKind.USER_AVATAR) {
      if (asset.userId === viewerId) return true;
      if (!asset.userId) return false;
      const subject = await this.prisma.user.findUnique({
        where: { id: asset.userId },
        select: { avatarConsentReferralList: true },
      });
      if (!subject?.avatarConsentReferralList) return false;
      // Exactly one hop. `ReferralInvite.refereeUserId` is unique and written
      // once at registration, so this is the person's *direct* inviter and
      // there is no way to walk further up from here.
      const invite = await this.prisma.referralInvite.findUnique({
        where: { refereeUserId: asset.userId },
        select: { referrerUserId: true },
      });
      return invite?.referrerUserId === viewerId;
    }

    if (MediaDeliveryService.isPubliclyDeliverable(asset)) return true;
    if (!asset.partnerId) return false;

    const [role, membership, admin] = await Promise.all([
      this.prisma.userRole.findFirst({ where: { userId: viewerId, partnerId: asset.partnerId } }),
      this.prisma.partnerMembership.findUnique({
        where: { partnerId_userId: { partnerId: asset.partnerId, userId: viewerId } },
      }),
      this.prisma.userRole.findFirst({
        where: { userId: viewerId, role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } },
      }),
    ]);
    return !!(role || membership || admin);
  }

  /**
   * `display` and `thumb` only.
   *
   * The `original` derivative is retained so a future change to the display
   * sizes can be re-derived without asking every partner to re-upload, but it
   * is not a delivery target: it is the largest, least-processed artefact the
   * platform holds, and no client has a use for it. Refusing it here means the
   * only bytes that ever leave are the two the UI actually renders.
   */
  private parseVariant(variant: string): MediaVariant {
    if (!isMediaVariant(variant) || variant === 'original') {
      throw new NotFoundException('Image not found');
    }
    return variant;
  }
}
