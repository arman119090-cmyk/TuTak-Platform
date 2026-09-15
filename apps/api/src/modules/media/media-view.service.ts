import { Injectable } from '@nestjs/common';
import { MediaAsset, MediaAssetStatus } from '@prisma/client';
import type { MediaAssetDto, MediaImageDto, PartnerBrandDto } from './media.contracts';
import { MediaDeliveryService } from '../../infrastructure/media/media-delivery.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * The single place a `MediaAsset` row becomes something a client may see.
 *
 * Every DTO that carries media goes through here, for one reason: the decision
 * "is this asset safe to show to this viewer, and by which URL" is exactly the
 * decision that must not be re-made, slightly differently, in eight
 * controllers. `PartnerPublicDto`, `NearbyPartnerDto`, `TransactionDto`,
 * `PurchaseIntentDto`, the EV history, the wallet rows and the referral list
 * all resolve their media here, so a change to what "publicly deliverable"
 * means changes all of them at once.
 */
@Injectable()
export class MediaViewService {
  constructor(
    private readonly delivery: MediaDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The public reference for a partner logo/cover, or null when there is
   * nothing safe to show.
   *
   * Accepts `REPLACED` as well as `ACTIVE` — that is the whole mechanism
   * behind spec §2.2's historical brand snapshots. Refuses `PENDING_REVIEW`
   * (never approved) and `REVOKED` (deliberately taken down).
   */
  publicImage(asset: MediaAsset | null | undefined): MediaImageDto | null {
    if (!asset || !MediaDeliveryService.isPubliclyDeliverable(asset)) return null;
    return {
      assetId: asset.id,
      url: this.delivery.publicUrl(asset.id, 'display'),
      thumbnailUrl: this.delivery.publicUrl(asset.id, 'thumb'),
      width: asset.width,
      height: asset.height,
    };
  }

  /** A signed reference, for an asset only this viewer is allowed to fetch. */
  signedImage(asset: MediaAsset | null | undefined, audienceUserId: string): MediaImageDto | null {
    if (!asset) return null;
    return {
      assetId: asset.id,
      url: this.delivery.signedUrl(asset.id, 'display', audienceUserId),
      thumbnailUrl: this.delivery.signedUrl(asset.id, 'thumb', audienceUserId),
      width: asset.width,
      height: asset.height,
    };
  }

  /** The management view — owner branding page and admin approval queue. */
  assetDto(asset: MediaAsset, audienceUserId: string): MediaAssetDto {
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      partnerId: asset.partnerId,
      userId: asset.userId,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      createdAt: asset.createdAt.toISOString(),
      approvedAt: asset.approvedAt?.toISOString() ?? null,
      uploadedByUserId: asset.uploadedByUserId,
      approvedByUserId: asset.approvedByUserId,
      // Always signed, even for an already-public asset: this surface shows
      // PENDING_REVIEW and REVOKED rows next to live ones, and one uniformly
      // authorised preview reference is one fewer place to leak a brand change
      // nobody has approved yet.
      preview: this.signedImage(asset, audienceUserId)!,
    };
  }

  /**
   * Resolves an operation's immutable brand snapshot into something renderable.
   *
   * The three cases, in the order they actually occur:
   *
   *  1. **Snapshotted, asset still deliverable** — the normal path. Returns
   *     the name and the logo as they were when the operation happened, even
   *     if the partner has since replaced both.
   *  2. **Snapshotted, asset revoked or gone** — keeps the snapshotted name
   *     and returns a null logo. The customer still recognises the row; the
   *     platform is not showing an image an administrator took down.
   *  3. **No snapshot at all** — every row written before this migration.
   *     Falls back to the partner's *current* display name and a null logo,
   *     which is precisely the behaviour those rows have today. Deliberately
   *     not backfilled with today's logo: that would assert the partner had
   *     that logo at a time when it demonstrably did not.
   */
  async brandFor(row: {
    partnerId: string | null;
    brandDisplayName: string | null;
    brandLogoAssetId: string | null;
    brandLogoAsset?: MediaAsset | null;
    partner?: { displayName: string } | null;
  }): Promise<PartnerBrandDto | null> {
    if (!row.partnerId) return null;

    const displayName =
      row.brandDisplayName ??
      row.partner?.displayName ??
      (await this.prisma.partner.findUnique({
        where: { id: row.partnerId },
        select: { displayName: true },
      }))?.displayName ??
      '';

    let asset = row.brandLogoAsset ?? null;
    if (!asset && row.brandLogoAssetId) {
      asset = await this.prisma.mediaAsset.findUnique({ where: { id: row.brandLogoAssetId } });
    }

    return { partnerId: row.partnerId, displayName, logo: this.publicImage(asset) };
  }

  /**
   * The same resolution for a batch of rows, with one query for the assets and
   * one for the partner names rather than two per row.
   *
   * A transaction history page is fifty rows; resolving each one on its own
   * turned a single indexed query into a hundred and one. Worth the extra
   * function.
   */
  async brandsFor<T extends {
    partnerId: string | null;
    brandDisplayName: string | null;
    brandLogoAssetId: string | null;
  }>(rows: T[]): Promise<Map<T, PartnerBrandDto | null>> {
    const assetIds = [...new Set(rows.map((r) => r.brandLogoAssetId).filter((id): id is string => !!id))];
    const partnerIds = [
      ...new Set(
        rows.filter((r) => r.partnerId && !r.brandDisplayName).map((r) => r.partnerId as string),
      ),
    ];

    const [assets, partners] = await Promise.all([
      assetIds.length
        ? this.prisma.mediaAsset.findMany({ where: { id: { in: assetIds } } })
        : Promise.resolve([]),
      partnerIds.length
        ? this.prisma.partner.findMany({
            where: { id: { in: partnerIds } },
            select: { id: true, displayName: true },
          })
        : Promise.resolve([]),
    ]);

    const assetById = new Map(assets.map((a) => [a.id, a]));
    const nameById = new Map(partners.map((p) => [p.id, p.displayName]));

    const out = new Map<T, PartnerBrandDto | null>();
    for (const row of rows) {
      if (!row.partnerId) {
        out.set(row, null);
        continue;
      }
      out.set(row, {
        partnerId: row.partnerId,
        displayName: row.brandDisplayName ?? nameById.get(row.partnerId) ?? '',
        logo: this.publicImage(row.brandLogoAssetId ? assetById.get(row.brandLogoAssetId) : null),
      });
    }
    return out;
  }

  /**
   * The logo/cover a *directory* card should show — spec §4: "The UI may use
   * the current brand on a directory card, but it must use the operation
   * snapshot in history/detail views."
   */
  currentPartnerImage(asset: MediaAsset | null | undefined): MediaImageDto | null {
    if (!asset || asset.status !== MediaAssetStatus.ACTIVE) return null;
    return this.publicImage(asset);
  }
}
