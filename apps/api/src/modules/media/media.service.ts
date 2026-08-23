import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  MediaAsset,
  MediaAssetKind,
  MediaAssetStatus,
  Prisma,
} from '@prisma/client';
import { MediaImageService } from '../../infrastructure/media/media-image.service';
import { mintMediaKeys } from '../../infrastructure/media/media-keys';
import { MEDIA_STORAGE, MediaStorage } from '../../infrastructure/media/media-storage.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Everything that *changes* media. Reading it is `MediaViewService`'s job.
 *
 * ## Why the write path looks the way it does
 *
 * Storage and the database cannot be committed together, so the order is
 * chosen for which inconsistency is survivable. Bytes are written first and
 * the row second: a crash in between leaves three orphaned objects nobody
 * references, which costs a few kilobytes and is invisible to every user. The
 * reverse order would leave a committed `MediaAsset` row whose derivatives do
 * not exist — a broken image on a partner card, with a database that insists
 * everything is fine. If the row insert fails, the objects just written are
 * deleted on the way out; if *that* delete fails too, the orphan is logged and
 * accepted, because failing the caller's upload over unreachable garbage would
 * be the wrong trade.
 *
 * ## Why a partner OWNER cannot publish
 *
 * Spec §1: an owner submits, a platform administrator confirms. A partner's
 * logo is its public identity across every customer's transaction history, and
 * an owner account is a single password away from a stranger. So an owner's
 * upload lands `PENDING_REVIEW` and is invisible to every customer surface
 * until `approve` runs; an administrator's own upload is approved in the same
 * call, because there is no second party left to ask.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: MediaImageService,
    private readonly audit: AuditService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  // ── Partner brand media ────────────────────────────────────────────────

  /**
   * Submits (owner) or publishes (administrator) a partner logo or cover.
   *
   * Authorisation is the caller's responsibility — see
   * `PartnerMediaController`, which runs `assertPartnerScope` +
   * `assertPartnerOwner` before reaching here. This method decides only the
   * *status* the new asset lands in, which is a different question.
   */
  async submitPartnerMedia(params: {
    partnerId: string;
    kind: Extract<MediaAssetKind, 'PARTNER_LOGO' | 'PARTNER_COVER'>;
    file: Buffer;
    actor: ActorContext;
    /** True only for a platform administrator — see the class docblock. */
    publishImmediately: boolean;
  }): Promise<MediaAsset> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: params.partnerId },
      select: { id: true, displayName: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    const asset = await this.storeAsset({
      kind: params.kind,
      file: params.file,
      partnerId: params.partnerId,
      userId: null,
      uploadedByUserId: params.actor.userId,
      status: params.publishImmediately ? MediaAssetStatus.ACTIVE : MediaAssetStatus.PENDING_REVIEW,
      approvedByUserId: params.publishImmediately ? params.actor.userId : null,
      // A partner may only have one queued submission per kind (enforced by
      // `media_assets_one_pending_per_partner_kind`), so a second submission
      // supersedes the first rather than piling up an ambiguous queue for the
      // administrator to guess between.
      supersedePending: true,
      publish: params.publishImmediately,
    });

    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_ASSET_UPLOADED,
      entityType: 'MediaAsset',
      entityId: asset.id,
      metadata: {
        partnerId: params.partnerId,
        kind: params.kind,
        status: asset.status,
        sha256: asset.sha256,
        byteSize: asset.byteSize,
      },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });

    return asset;
  }

  /**
   * A platform administrator confirms a submission, and it becomes the
   * partner's public identity.
   *
   * The previous published asset of the same kind moves to `REPLACED`, not to
   * deleted: spec §2.2 requires every operation that snapshotted it to keep
   * rendering it for the financial-record retention period. That is the entire
   * reason `REPLACED` is a distinct status from `REVOKED`.
   */
  async approvePartnerMedia(params: {
    partnerId: string;
    assetId: string;
    actor: ActorContext;
  }): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: params.assetId } });
    if (!asset || asset.partnerId !== params.partnerId) {
      // Deliberately the same 404 for "no such asset" and "an asset belonging
      // to somebody else": spec §3.3 forbids accepting an asset id from
      // another owner, and confirming that a stranger's id exists is a small
      // leak with no upside.
      throw new NotFoundException('Media asset not found for this partner');
    }
    if (asset.status !== MediaAssetStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Only a submission awaiting review can be approved (current status: ${asset.status})`,
      );
    }

    const approved = await this.prisma.$transaction(async (tx) => {
      await this.retirePublished(tx, params.partnerId, asset.kind, MediaAssetStatus.REPLACED);
      const updated = await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaAssetStatus.ACTIVE,
          approvedAt: new Date(),
          approvedByUserId: params.actor.userId,
        },
      });
      await tx.partner.update({
        where: { id: params.partnerId },
        data: pointerFor(asset.kind, updated.id),
      });
      return updated;
    });

    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_ASSET_APPROVED,
      entityType: 'MediaAsset',
      entityId: approved.id,
      metadata: { partnerId: params.partnerId, kind: approved.kind },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });
    return approved;
  }

  /**
   * A platform administrator takes a partner's published media down.
   *
   * `REVOKED`, never deleted, and the derivatives stay in storage — spec §3.3
   * says to retain record-needed derivatives rather than hard-delete history.
   * What changes is that the asset stops being deliverable *at all*, including
   * to the historical operations that snapshotted it, which is the point:
   * revocation is the control for a file that must stop being shown. An
   * ordinary rebrand is an approval, not a revocation, and leaves history
   * intact.
   */
  async revokePartnerMedia(params: {
    partnerId: string;
    kind: Extract<MediaAssetKind, 'PARTNER_LOGO' | 'PARTNER_COVER'>;
    actor: ActorContext;
  }): Promise<{ revokedAssetId: string | null }> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: params.partnerId },
      select: { id: true, logoAssetId: true, coverAssetId: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    const currentId = params.kind === MediaAssetKind.PARTNER_LOGO ? partner.logoAssetId : partner.coverAssetId;
    if (!currentId) return { revokedAssetId: null };

    await this.prisma.$transaction(async (tx) => {
      await this.retirePublished(tx, params.partnerId, params.kind, MediaAssetStatus.REVOKED);
      await tx.partner.update({
        where: { id: params.partnerId },
        data: pointerFor(params.kind, null),
      });
    });

    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_ASSET_REVOKED,
      entityType: 'MediaAsset',
      entityId: currentId,
      metadata: { partnerId: params.partnerId, kind: params.kind },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });
    return { revokedAssetId: currentId };
  }

  // ── Customer avatars ───────────────────────────────────────────────────

  /**
   * Uploads or replaces the caller's own avatar.
   *
   * No approval step, and deliberately so: this is a person's own picture on
   * their own profile, seen by them and — only under explicit consent — by the
   * one person who invited them. There is no public identity to protect and
   * nobody downstream who would be misled, which is exactly the asymmetry that
   * makes a partner logo need an administrator and this not need one.
   *
   * The previous avatar becomes `REPLACED` rather than being deleted, so any
   * URL already handed out keeps resolving until it expires instead of turning
   * into a broken image mid-session.
   */
  async setUserAvatar(params: { userId: string; file: Buffer; actor: ActorContext }): Promise<MediaAsset> {
    const asset = await this.storeAsset({
      kind: MediaAssetKind.USER_AVATAR,
      file: params.file,
      partnerId: null,
      userId: params.userId,
      uploadedByUserId: params.actor.userId,
      status: MediaAssetStatus.ACTIVE,
      approvedByUserId: null,
      supersedePending: false,
      publish: true,
    });

    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_ASSET_UPLOADED,
      entityType: 'MediaAsset',
      entityId: asset.id,
      metadata: { userId: params.userId, kind: MediaAssetKind.USER_AVATAR, sha256: asset.sha256 },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });
    return asset;
  }

  async removeUserAvatar(params: { userId: string; actor: ActorContext }): Promise<{ removedAssetId: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { avatarAssetId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.avatarAssetId) return { removedAssetId: null };

    const removedId = user.avatarAssetId;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: params.userId }, data: { avatarAssetId: null } });
      await tx.mediaAsset.updateMany({
        where: { userId: params.userId, kind: MediaAssetKind.USER_AVATAR, status: MediaAssetStatus.ACTIVE },
        data: { status: MediaAssetStatus.REVOKED, revokedAt: new Date(), approvedAt: new Date() },
      });
    });

    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_ASSET_REVOKED,
      entityType: 'MediaAsset',
      entityId: removedId,
      metadata: { userId: params.userId, kind: MediaAssetKind.USER_AVATAR },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });
    return { removedAssetId: removedId };
  }

  async setAvatarConsent(params: {
    userId: string;
    consent: boolean;
    actor: ActorContext;
  }): Promise<{ showAvatarInReferralList: boolean }> {
    const updated = await this.prisma.user.update({
      where: { id: params.userId },
      data: { avatarConsentReferralList: params.consent },
      select: { avatarConsentReferralList: true },
    });
    await this.audit.record({
      actorUserId: params.actor.userId,
      action: AuditAction.MEDIA_AVATAR_CONSENT_CHANGED,
      entityType: 'User',
      entityId: params.userId,
      metadata: { showAvatarInReferralList: updated.avatarConsentReferralList },
      ipAddress: params.actor.ipAddress,
      userAgent: params.actor.userAgent,
    });
    return { showAvatarInReferralList: updated.avatarConsentReferralList };
  }

  // ── Shared write path ──────────────────────────────────────────────────

  private async storeAsset(params: {
    kind: MediaAssetKind;
    file: Buffer;
    partnerId: string | null;
    userId: string | null;
    uploadedByUserId: string;
    status: MediaAssetStatus;
    approvedByUserId: string | null;
    supersedePending: boolean;
    publish: boolean;
  }): Promise<MediaAsset> {
    const processed = await this.images.process(params.file, params.kind);
    const keys = mintMediaKeys(params.kind);

    // Bytes first — see the class docblock for why this order and not the
    // other one.
    await this.storage.put(keys.original, processed.original.body, processed.original.contentType);
    await this.storage.put(keys.display, processed.display.body, processed.display.contentType);
    await this.storage.put(keys.thumb, processed.thumbnail.body, processed.thumbnail.contentType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (params.supersedePending && params.partnerId) {
          // A superseded submission was never public and nothing snapshotted
          // it, so there is no history to protect: REVOKED, and the partial
          // unique index stays satisfied.
          await tx.mediaAsset.updateMany({
            where: {
              partnerId: params.partnerId,
              kind: params.kind,
              status: MediaAssetStatus.PENDING_REVIEW,
            },
            data: { status: MediaAssetStatus.REVOKED, revokedAt: new Date(), approvedAt: new Date() },
          });
        }

        if (params.publish) {
          if (params.partnerId) {
            await this.retirePublished(tx, params.partnerId, params.kind, MediaAssetStatus.REPLACED);
          } else if (params.userId) {
            await tx.mediaAsset.updateMany({
              where: {
                userId: params.userId,
                kind: MediaAssetKind.USER_AVATAR,
                status: MediaAssetStatus.ACTIVE,
              },
              data: { status: MediaAssetStatus.REPLACED, replacedAt: new Date(), approvedAt: new Date() },
            });
          }
        }

        const asset = await tx.mediaAsset.create({
          data: {
            kind: params.kind,
            status: params.status,
            userId: params.userId,
            partnerId: params.partnerId,
            storageKey: keys.original,
            displayKey: keys.display,
            thumbnailKey: keys.thumb,
            width: processed.display.width,
            height: processed.display.height,
            mimeType: processed.display.contentType,
            byteSize: processed.display.body.length,
            sha256: processed.sha256,
            uploadedByUserId: params.uploadedByUserId,
            approvedByUserId: params.approvedByUserId,
            // The DB's `media_assets_approval_stamped` CHECK insists that
            // anything past PENDING_REVIEW says when it got there.
            approvedAt: params.status === MediaAssetStatus.PENDING_REVIEW ? null : new Date(),
          },
        });

        if (params.publish) {
          if (params.partnerId) {
            await tx.partner.update({
              where: { id: params.partnerId },
              data: pointerFor(params.kind, asset.id),
            });
          } else if (params.userId) {
            await tx.user.update({ where: { id: params.userId }, data: { avatarAssetId: asset.id } });
          }
        }

        return asset;
      });
    } catch (err) {
      await Promise.all(
        Object.values(keys).map((key) =>
          this.storage.delete(key).catch((cleanupError: unknown) => {
            // Logged, not rethrown: the caller's upload already failed for a
            // real reason, and replacing that reason with "and also we could
            // not tidy up" helps nobody. An orphaned object costs kilobytes.
            this.logger.warn(
              `Orphaned media object ${key} after a failed upload: ${String(cleanupError)}`,
            );
          }),
        ),
      );
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Another upload for this subject completed at the same moment. Please try again.',
        );
      }
      throw err;
    }
  }

  /**
   * Moves whatever is currently published for this partner and kind out of the
   * way, and returns the pointer to null so the partial unique index never
   * sees two live rows.
   */
  private async retirePublished(
    tx: Prisma.TransactionClient,
    partnerId: string,
    kind: MediaAssetKind,
    to: Extract<MediaAssetStatus, 'REPLACED' | 'REVOKED'>,
  ): Promise<void> {
    const now = new Date();
    await tx.mediaAsset.updateMany({
      where: { partnerId, kind, status: MediaAssetStatus.ACTIVE },
      data: {
        status: to,
        approvedAt: now,
        ...(to === MediaAssetStatus.REPLACED ? { replacedAt: now } : { revokedAt: now }),
      },
    });
  }

  // ── Reads that belong with the writes ──────────────────────────────────

  /** Every asset a partner owns, newest first. Owner/administrator only. */
  listPartnerAssets(partnerId: string): Promise<MediaAsset[]> {
    return this.prisma.mediaAsset.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The platform-wide approval queue. Administrators only. */
  listPendingReview(): Promise<(MediaAsset & { partner: { id: string; displayName: string } | null })[]> {
    return this.prisma.mediaAsset.findMany({
      where: { status: MediaAssetStatus.PENDING_REVIEW },
      orderBy: { createdAt: 'asc' },
      include: { partner: { select: { id: true, displayName: true } } },
    });
  }

  findAsset(assetId: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
  }

  /** Reads one derivative's bytes. Callers must have authorised the read. */
  async readVariant(asset: MediaAsset, variant: 'original' | 'display' | 'thumb') {
    const key =
      variant === 'original' ? asset.storageKey : variant === 'display' ? asset.displayKey : asset.thumbnailKey;
    const object = await this.storage.get(key);
    if (!object) {
      throw new NotFoundException('This image is no longer available');
    }
    return object;
  }
}

/** Which `Partner` column points at an asset of this kind. */
function pointerFor(kind: MediaAssetKind, assetId: string | null): { logoAssetId?: string | null; coverAssetId?: string | null } {
  switch (kind) {
    case MediaAssetKind.PARTNER_LOGO:
      return { logoAssetId: assetId };
    case MediaAssetKind.PARTNER_COVER:
      return { coverAssetId: assetId };
    default:
      throw new BadRequestException(`${kind} is not a partner brand asset`);
  }
}
