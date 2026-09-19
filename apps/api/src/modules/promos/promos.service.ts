import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, MediaAssetStatus, PartnerPromoDestination, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaViewService } from '../media/media-view.service';
import { MediaService, type ActorContext } from '../media/media.service';
import type { MediaImageDto } from '../media/media.contracts';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';
import type { PromoEventType } from './dto/promo-event.dto';
import {
  availableLocales,
  normaliseTranslations,
  PROMO_FALLBACK_LOCALE,
  readTranslations,
  resolvePromoCopy,
  type PromoLocale,
  type PromoTranslations,
} from './promo-translations';
import { FEATURED_PROMO_LIMIT, isPromoLive, isWindowOrdered, livePromoWhere } from './promo-window';

/**
 * The response shapes, restated for the API (see `media.contracts.ts` for
 * why the API keeps its own mirrors of `@tutak/shared-types`).
 */
export interface PartnerPromoPublicDto {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerLogo: MediaImageDto | null;
  /** The interface language this copy came from — requested, or a fallback. */
  locale: PromoLocale;
  title: string;
  subtitle: string | null;
  benefitLabel: string;
  artwork: MediaImageDto | null;
  destination: PartnerPromoDestination;
  sponsored: boolean;
}

export interface PartnerPromoAdminDto extends PartnerPromoPublicDto {
  translations: PromoTranslations;
  /** Locales with a title and a benefit label — what the app can show. */
  availableLocales: PromoLocale[];
  active: boolean;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  live: boolean;
  impressionCount: number;
  openCount: number;
  createdAt: string;
  updatedAt: string;
}

const withRelations = {
  partner: { select: { displayName: true, isActive: true, status: true, logoAsset: true } },
  artworkAsset: true,
} satisfies Prisma.PartnerPromoInclude;

type PromoRow = Prisma.PartnerPromoGetPayload<{ include: typeof withRelations }>;

/**
 * Home "Partner Spotlight" — curated featured-partner placements.
 *
 * Two readers, one rule. The app asks for what is live now and gets at most
 * `FEATURED_PROMO_LIMIT` cards; the admin panel asks for everything and gets
 * each card's `live` flag computed by the *same* predicate the app's query
 * uses (`promo-window.ts`), so "why is my card not showing" is always
 * answerable from the panel.
 *
 * Counters are the only thing the app writes back, and they are counters:
 * an impression increments an integer on the card and records nothing about
 * who saw it.
 */
@Injectable()
export class PromosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: MediaViewService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * What the app shows, in its own language. Ordered by priority, then
   * newest first. A card with no complete translation at all is dropped
   * here rather than served empty — so the take is over-fetched and cut
   * after the language check.
   */
  async featured(locale?: PromoLocale, now: Date = new Date()): Promise<PartnerPromoPublicDto[]> {
    const rows = await this.prisma.partnerPromo.findMany({
      where: livePromoWhere(now),
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: FEATURED_PROMO_LIMIT * 2,
      include: withRelations,
    });
    return rows
      .map((row) => this.toPublic(row, locale))
      .filter((dto): dto is PartnerPromoPublicDto => dto !== null)
      .slice(0, FEATURED_PROMO_LIMIT);
  }

  async list(locale?: PromoLocale, now: Date = new Date()): Promise<PartnerPromoAdminDto[]> {
    const rows = await this.prisma.partnerPromo.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: withRelations,
    });
    return rows.map((row) => this.toAdmin(row, locale, now));
  }

  async create(dto: CreatePromoDto, actor: ActorContext): Promise<PartnerPromoAdminDto> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: dto.partnerId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (!isWindowOrdered(startAt, endAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }
    const translations = normaliseTranslations(dto.translations as PromoTranslations);
    if (availableLocales(translations).length === 0) {
      throw new BadRequestException('At least one language needs a title and a benefit label');
    }

    const row = await this.prisma.partnerPromo.create({
      data: {
        partnerId: dto.partnerId,
        translations: translations as Prisma.InputJsonValue,
        destination: dto.destination ?? PartnerPromoDestination.PARTNER,
        sponsored: dto.sponsored ?? false,
        active: dto.active ?? false,
        priority: dto.priority ?? 0,
        startAt,
        endAt,
        createdByUserId: actor.userId,
      },
      include: withRelations,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.PARTNER_PROMO_CREATED,
      entityType: 'PartnerPromo',
      entityId: row.id,
      metadata: { partnerId: row.partnerId, active: row.active, startAt, endAt },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.toAdmin(row, undefined, new Date());
  }

  async update(id: string, dto: UpdatePromoDto, actor: ActorContext): Promise<PartnerPromoAdminDto> {
    const current = await this.prisma.partnerPromo.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo not found');

    // The window is validated as it will be after the edit, not field by
    // field: moving only `startAt` past an existing `endAt` is the mistake
    // the CHECK constraint would catch anyway, said here in words.
    const startAt = dto.startAt === undefined ? current.startAt : dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt === undefined ? current.endAt : dto.endAt ? new Date(dto.endAt) : null;
    if (!isWindowOrdered(startAt, endAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }

    let translations: PromoTranslations | undefined;
    if (dto.translations !== undefined) {
      translations = normaliseTranslations(dto.translations as PromoTranslations);
      if (availableLocales(translations).length === 0) {
        throw new BadRequestException('At least one language needs a title and a benefit label');
      }
    }

    const row = await this.prisma.partnerPromo.update({
      where: { id },
      data: {
        ...(translations !== undefined ? { translations: translations as Prisma.InputJsonValue } : {}),
        ...(dto.destination !== undefined ? { destination: dto.destination } : {}),
        ...(dto.sponsored !== undefined ? { sponsored: dto.sponsored } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        startAt,
        endAt,
      },
      include: withRelations,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.PARTNER_PROMO_UPDATED,
      entityType: 'PartnerPromo',
      entityId: row.id,
      metadata: { changed: Object.keys(dto), active: row.active, startAt, endAt },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.toAdmin(row, undefined, new Date());
  }

  /**
   * Replaces the card's artwork. The previous asset moves to `REPLACED` —
   * still deliverable, so a cached card keeps rendering until it refreshes,
   * but no longer the one this card points at.
   */
  async setArtwork(id: string, file: Buffer, actor: ActorContext): Promise<PartnerPromoAdminDto> {
    const current = await this.prisma.partnerPromo.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo not found');

    const asset = await this.media.storePromoArtwork({ partnerId: current.partnerId, file, actor });

    const row = await this.prisma.$transaction(async (tx) => {
      if (current.artworkAssetId) {
        await tx.mediaAsset.updateMany({
          where: { id: current.artworkAssetId, status: MediaAssetStatus.ACTIVE },
          data: { status: MediaAssetStatus.REPLACED, replacedAt: new Date() },
        });
      }
      return tx.partnerPromo.update({
        where: { id },
        data: { artworkAssetId: asset.id },
        include: withRelations,
      });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.PARTNER_PROMO_UPDATED,
      entityType: 'PartnerPromo',
      entityId: row.id,
      metadata: { changed: ['artworkAssetId'], artworkAssetId: asset.id, replaced: current.artworkAssetId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.toAdmin(row, undefined, new Date());
  }

  /**
   * One more impression or open on a card. Silent on an unknown id: the app
   * may report a card that was deleted between the fetch and the tap, and a
   * 404 for an analytics ping would only make the app retry it.
   */
  async recordEvent(id: string, type: PromoEventType): Promise<void> {
    await this.prisma.partnerPromo.updateMany({
      where: { id },
      data: type === 'OPEN' ? { openCount: { increment: 1 } } : { impressionCount: { increment: 1 } },
    });
  }

  private toPublic(row: PromoRow, locale?: PromoLocale): PartnerPromoPublicDto | null {
    const copy = resolvePromoCopy(readTranslations(row.translations), locale);
    if (!copy) return null;
    return {
      id: row.id,
      partnerId: row.partnerId,
      partnerName: row.partner.displayName,
      partnerLogo: this.view.publicImage(row.partner.logoAsset),
      locale: copy.locale,
      title: copy.title,
      subtitle: copy.subtitle ?? null,
      benefitLabel: copy.benefitLabel,
      artwork: this.view.publicImage(row.artworkAsset),
      destination: row.destination,
      sponsored: row.sponsored,
    };
  }

  /**
   * The management view never drops a card: a row with no complete language
   * is exactly the row an administrator needs to see, so its copy falls back
   * to empty strings and `availableLocales` says why it is not live.
   */
  private toAdmin(row: PromoRow, locale: PromoLocale | undefined, now: Date): PartnerPromoAdminDto {
    const translations = readTranslations(row.translations);
    const locales = availableLocales(translations);
    const resolved = this.toPublic(row, locale ?? PROMO_FALLBACK_LOCALE) ?? {
      id: row.id,
      partnerId: row.partnerId,
      partnerName: row.partner.displayName,
      partnerLogo: this.view.publicImage(row.partner.logoAsset),
      locale: locale ?? PROMO_FALLBACK_LOCALE,
      title: '',
      subtitle: null,
      benefitLabel: '',
      artwork: this.view.publicImage(row.artworkAsset),
      destination: row.destination,
      sponsored: row.sponsored,
    };
    return {
      ...resolved,
      translations,
      availableLocales: locales,
      active: row.active,
      priority: row.priority,
      startAt: row.startAt?.toISOString() ?? null,
      endAt: row.endAt?.toISOString() ?? null,
      live: isPromoLive(row, now) && locales.length > 0,
      impressionCount: row.impressionCount,
      openCount: row.openCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
