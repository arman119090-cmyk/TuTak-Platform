import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaAsset, PartnerOfferingItem, PartnerStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaViewService } from '../media/media-view.service';
import { TransactionsService } from '../transactions/transactions.service';
import { isCommissionRateBps } from '../../common/validators/is-commission-rate-bps.validator';
import { parseMoney } from '../../common/utils/money';
import { ApplyPartnerDto } from './dto/apply-partner.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PartnerOfferingInputDto } from './dto/replace-partner-offerings.dto';
import {
  haversineKm,
  toPartnerCategory,
  type FuelType,
  type NearbyPartner,
  type PartnerCategory,
} from './geo';

/** A joined-in `MediaAsset`, which may legitimately be absent. */
type MediaAssetRow = MediaAsset | null;

/**
 * Below this many completed purchases in a category, "recommending" it back
 * to the customer would just be echoing a single coincidence — see
 * `PartnersService.recommendedCategoriesFor`.
 */
const MIN_PURCHASES_FOR_RECOMMENDATION = 2;
/** Enough to feel personal; few enough that "recommended" stays a meaningful label, not most of the list. */
const MAX_RECOMMENDED_CATEGORIES = 2;

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaViewService,
    private readonly transactions: TransactionsService,
  ) {}

  async create(dto: CreatePartnerDto) {
    // The DTO already validates this; re-checked here so a caller that
    // builds a Partner without going through the HTTP boundary (a script, a
    // future internal service) still can't write an off-grid rate.
    if (!isCommissionRateBps(dto.bonusAccrualRateBps)) {
      throw new BadRequestException('bonusAccrualRateBps must be on the 0.5% commission grid');
    }
    const ownerRole = await this.prisma.role.findUniqueOrThrow({
      where: { name: RoleName.PARTNER_OWNER },
    });

    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          legalName: dto.legalName,
          displayName: dto.displayName,
          taxId: dto.taxId,
          category: dto.category,
          bonusAccrualRateBps: dto.bonusAccrualRateBps,
          sellsGas: dto.sellsGas ?? false,
          sellsPetrol: dto.sellsPetrol ?? false,
          // The admin path activates immediately — same behaviour as before
          // this migration. `status` defaults to ACTIVE (see schema.prisma),
          // so nothing here needs to say so explicitly.
        },
      });

      await tx.partnerMembership.create({
        data: { partnerId: partner.id, userId: dto.ownerUserId },
      });

      await tx.userRole.create({
        data: { userId: dto.ownerUserId, roleId: ownerRole.id, partnerId: partner.id },
      });

      // Active from the moment it exists — spec §21: a partner may be a
      // direct referrer, and that needs a code to hand out.
      await this.ensureReferralCode(partner.id, tx);

      return partner;
    });
  }

  /**
   * Spec §21: a partner may be a direct referrer, same as a user. Idempotent
   * — `partnerId` is `@unique` on `ReferralCode`, so calling this twice for
   * the same partner (e.g. once from `create`, again if something ever
   * re-runs `approve`) is a no-op the second time rather than an error.
   */
  private async ensureReferralCode(partnerId: string, tx: Prisma.TransactionClient) {
    const existing = await tx.referralCode.findUnique({ where: { partnerId } });
    if (existing) return existing;
    return tx.referralCode.create({
      data: { partnerId, code: `TP-${partnerId.slice(0, 8).toUpperCase()}` },
    });
  }

  /**
   * Self-service application — spec §2. Creates the partner in
   * `PENDING_APPROVAL`, `isActive: false`: `findActiveOrThrow` refuses it,
   * so no QR redemption, EV session, or PurchaseIntent confirmation can run
   * against it until `approve()` is called. The applicant becomes the
   * partner's owner immediately — approval controls trading, not membership.
   */
  async apply(dto: ApplyPartnerDto, applicantUserId: string) {
    if (!isCommissionRateBps(dto.bonusAccrualRateBps)) {
      throw new BadRequestException('bonusAccrualRateBps must be on the 0.5% commission grid');
    }
    const ownerRole = await this.prisma.role.findUniqueOrThrow({
      where: { name: RoleName.PARTNER_OWNER },
    });

    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          legalName: dto.legalName,
          displayName: dto.displayName,
          taxId: dto.taxId,
          category: dto.category,
          bonusAccrualRateBps: dto.bonusAccrualRateBps,
          status: PartnerStatus.PENDING_APPROVAL,
          isActive: false,
        },
      });

      await tx.partnerMembership.create({
        data: { partnerId: partner.id, userId: applicantUserId },
      });

      await tx.userRole.create({
        data: { userId: applicantUserId, roleId: ownerRole.id, partnerId: partner.id },
      });

      return partner;
    });
  }

  /**
   * Admin approval. Only a `PENDING_APPROVAL` partner may be approved —
   * approving an already-active or rejected partner is refused rather than
   * silently accepted, because the caller almost certainly meant something
   * else (re-activating a suspended partner is `setActive(true)`, not this).
   */
  async approve(id: string) {
    const partner = await this.findByIdOrThrow(id);
    if (partner.status !== PartnerStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Only a pending application can be approved (current status: ${partner.status})`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.partner.update({
        where: { id },
        data: { status: PartnerStatus.ACTIVE, isActive: true },
      });
      await this.ensureReferralCode(updated.id, tx);
      return updated;
    });
  }

  async reject(id: string, reason: string) {
    const partner = await this.findByIdOrThrow(id);
    if (partner.status !== PartnerStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Only a pending application can be rejected (current status: ${partner.status})`,
      );
    }
    return this.prisma.partner.update({
      where: { id },
      data: {
        status: PartnerStatus.REJECTED,
        isActive: false,
        payoutsBlockedReason: reason,
      },
    });
  }

  /**
   * Spec §11: only `maxBonusPaymentPercent` is writable here, and only by a
   * partner's own OWNER (enforced by the controller, not this method — see
   * the note on `PATCH /partners/:id/commercial-settings`). The negotiated
   * rate itself stays admin-only and has no setter here at all.
   */
  updateCommercialSettings(id: string, data: { maxBonusPaymentPercent?: number }) {
    return this.prisma.partner.update({ where: { id }, data });
  }

  /**
   * Sets the partner's own "about" text. No approval step — see `about`'s
   * doc comment on the schema. An empty/whitespace-only string is stored as
   * `null` rather than as an empty paragraph, so `PartnerPublicDto.about`
   * stays a clean "has one or doesn't" signal for the client's "don't render
   * an empty section" rule.
   */
  async updateAbout(id: string, about: string | null | undefined) {
    if (about === undefined) return this.findByIdOrThrow(id);
    const trimmed = about?.trim() || null;
    await this.prisma.partner.update({ where: { id }, data: { about: trimmed } });
    return this.findByIdOrThrow(id);
  }

  /**
   * Partner self-service: what a `fuel`-category station actually sells —
   * see `Partner.sellsGas`/`sellsPetrol`. Meaningless for any other category,
   * but not rejected for one: a partner that later switches its own category
   * to `fuel` should not first have to re-declare flags it already set.
   */
  async updateFuelTypes(id: string, dto: { sellsGas?: boolean; sellsPetrol?: boolean }) {
    await this.prisma.partner.update({
      where: { id },
      data: {
        ...(dto.sellsGas !== undefined ? { sellsGas: dto.sellsGas } : {}),
        ...(dto.sellsPetrol !== undefined ? { sellsPetrol: dto.sellsPetrol } : {}),
      },
    });
    return this.findByIdOrThrow(id);
  }

  /**
   * Replaces the partner's whole offering list in one transaction — see
   * `ReplacePartnerOfferingsDto`'s doc comment for why bulk-replace rather
   * than per-item CRUD. `displayOrder` is written as the submitted array's
   * own index, so the order the partner saves is the order the customer
   * sees; re-submitting the same list with items reordered is exactly how a
   * partner reorders it.
   *
   * Old rows are deleted and new ones created rather than diffed and
   * updated in place: a diff buys nothing here (nobody else references an
   * offering row by id — see the model's own doc comment on why that is
   * deliberate for now) and a delete-then-insert is simpler to get right
   * inside one transaction than reconciling adds/removes/reorders by hand.
   */
  async replaceOfferings(id: string, items: PartnerOfferingInputDto[]) {
    const parsed = items.map((item) => ({
      name: item.name.trim(),
      description: item.description?.trim() || null,
      price: parseMoney(item.price, 'price', { allowZero: false }),
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.partnerOfferingItem.deleteMany({ where: { partnerId: id } });
      if (parsed.length > 0) {
        await tx.partnerOfferingItem.createMany({
          data: parsed.map((item, index) => ({ ...item, partnerId: id, displayOrder: index })),
        });
      }
    });

    const offerings = await this.prisma.partnerOfferingItem.findMany({
      where: { partnerId: id },
      orderBy: { displayOrder: 'asc' },
    });
    return offerings.map((o) => PartnersService.offeringDto(o));
  }

  /**
   * A partner's own branches, active and inactive alike — the dashboard's
   * "my locations" list needs to show a closed branch too, so the partner
   * can reopen it rather than having to recreate it from scratch.
   */
  listBranches(partnerId: string) {
    return this.prisma.partnerBranch.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Sanity ceiling, not a business limit — no real chain in this market approaches it; it exists so a scripting mistake cannot flood the map with rows. */
  private static readonly MAX_BRANCHES_PER_PARTNER = 200;

  async createBranch(partnerId: string, dto: { name: string; address: string; city: string; latitude: number; longitude: number }) {
    const existing = await this.prisma.partnerBranch.count({ where: { partnerId } });
    if (existing >= PartnersService.MAX_BRANCHES_PER_PARTNER) {
      throw new BadRequestException(
        `A partner may not have more than ${PartnersService.MAX_BRANCHES_PER_PARTNER} branches`,
      );
    }
    return this.prisma.partnerBranch.create({
      data: {
        partnerId,
        name: dto.name.trim(),
        address: dto.address.trim(),
        city: dto.city.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  /** Throws if `branchId` does not belong to `partnerId` — never lets one partner edit another's branch by guessing an id. */
  async updateBranch(
    partnerId: string,
    branchId: string,
    dto: { name?: string; address?: string; city?: string; latitude?: number; longitude?: number },
  ) {
    const { count } = await this.prisma.partnerBranch.updateMany({
      where: { id: branchId, partnerId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Branch not found');
    return this.prisma.partnerBranch.findUniqueOrThrow({ where: { id: branchId } });
  }

  /** Deactivating rather than deleting — see `PartnerBranch.isActive`'s own docblock. */
  async setBranchActive(partnerId: string, branchId: string, isActive: boolean) {
    const { count } = await this.prisma.partnerBranch.updateMany({
      where: { id: branchId, partnerId },
      data: { isActive },
    });
    if (count === 0) throw new NotFoundException('Branch not found');
    return this.prisma.partnerBranch.findUniqueOrThrow({ where: { id: branchId } });
  }

  findById(id: string) {
    return this.prisma.partner.findUnique({
      where: { id },
      include: { branches: true, offerings: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  async findByIdOrThrow(id: string) {
    const partner = await this.findById(id);
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  /**
   * Like findByIdOrThrow, but refuses a partner that has been switched off.
   *
   * `isActive` was written by PATCH /partners/:id/active and read by nothing:
   * deactivating a fraudulent or terminated partner had no effect at all,
   * their QR codes kept redeeming and kept accruing bonus at the platform's
   * expense, and the admin control appeared to work while doing nothing
   * (docs/AUDIT_2026-08-B.md §H3).
   */
  async findActiveOrThrow(id: string) {
    const partner = await this.findByIdOrThrow(id);
    if (!partner.isActive) {
      throw new BadRequestException('This partner is not currently active');
    }
    return partner;
  }

  /**
   * What a partner looks like to someone who is not part of it.
   *
   * The full row was being handed to every authenticated caller, customers
   * included, and it carries three things that have no business leaving the
   * platform: `taxId`, `paymentCommissionRateBps` — the commercial terms
   * negotiated with that partner individually — and `payoutsBlockedAt` /
   * `payoutsBlockedReason`, which announce that a business is under a
   * financial dispute and why.
   *
   * `bonusAccrualRateBps` stays: it is the cashback rate, which the partner
   * advertises and the customer is entitled to know before paying.
   */
  private static readonly PUBLIC_FIELDS = {
    id: true,
    displayName: true,
    category: true,
    sellsGas: true,
    sellsPetrol: true,
    bonusAccrualRateBps: true,
    isActive: true,
    createdAt: true,
    // The brand a directory card shows — spec §1.3/§4. The whole asset row is
    // selected rather than just the id because `MediaViewService` needs its
    // status to decide whether it is deliverable at all: a submission still
    // in PENDING_REVIEW must never reach a customer through this projection,
    // and `logoAssetId` alone cannot express that.
    logoAsset: true,
    coverAsset: true,
    // The public profile confirmed with Arman 2026-08-23. Unlike the media
    // fields above there is no status to gate on — `about`/`offerings` are
    // live the instant the partner writes them, so the raw column and the
    // ordered child rows are the whole story.
    about: true,
    offerings: { orderBy: { displayOrder: 'asc' as const } },
  } as const;

  /**
   * Strips the raw asset rows off a public projection and replaces them with
   * delivery-safe references.
   *
   * The rows themselves carry storage keys, which spec §3.3 says never reach a
   * client. Doing this in one private helper — rather than in each of the
   * three call sites — is what stops one of them from being forgotten.
   */
  private toPublicDto<
    T extends { logoAsset: MediaAssetRow; coverAsset: MediaAssetRow; offerings?: PartnerOfferingItem[] },
  >(partner: T) {
    const { logoAsset, coverAsset, offerings, ...rest } = partner;
    return {
      ...rest,
      logo: this.media.currentPartnerImage(logoAsset),
      cover: this.media.currentPartnerImage(coverAsset),
      offerings: (offerings ?? []).map((o) => PartnersService.offeringDto(o)),
    };
  }

  /**
   * `PartnerOfferingItem` → `PartnerOfferingDto`. Strips `partnerId`,
   * `displayOrder`, `createdAt`, `updatedAt` — internal-only, same discipline
   * `PUBLIC_FIELDS` applies to the partner row itself.
   */
  private static offeringDto(item: PartnerOfferingItem) {
    return { id: item.id, name: item.name, description: item.description, price: item.price };
  }

  /** Every partner, in the projection safe for any authenticated caller. */
  async listPublic() {
    const partners = await this.prisma.partner.findMany({
      select: PartnersService.PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
    return partners.map((partner) => this.toPublicDto(partner));
  }

  /** Every partner, in full. Callers must hold PARTNER_MANAGE. */
  async list() {
    const partners = await this.prisma.partner.findMany({
      orderBy: { createdAt: 'desc' },
      include: { logoAsset: true, coverAsset: true, offerings: { orderBy: { displayOrder: 'asc' } } },
    });
    return partners.map((partner) => this.toPublicDto(partner));
  }

  /** One partner, in the projection safe for any authenticated caller. */
  async findPublicOrThrow(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: PartnersService.PUBLIC_FIELDS,
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return this.toPublicDto(partner);
  }

  async isMember(partnerId: string, userId: string) {
    const membership = await this.prisma.partnerMembership.findUnique({
      where: { partnerId_userId: { partnerId, userId } },
    });
    return !!membership;
  }

  /**
   * True if this user is affiliated with this partner *at all* — either a
   * `PartnerMembership` row (only ever created for the founding owner, by
   * `create`/`apply` above) or a partner-scoped `UserRole` (how every other
   * staff member — OWNER, MANAGER, or STAFF added later — actually gets
   * attached to a partner, via `AdminService.assignRole`, which does not
   * also create a `PartnerMembership`). `isMember` alone under-detects for
   * exactly that reason: checking it in isolation would only ever catch a
   * partner's founding owner, not staff added afterward. Used for
   * self-dealing checks, where under-detecting is a real financial hole,
   * not merely a UX gap.
   */
  async isAffiliated(partnerId: string, userId: string): Promise<boolean> {
    const [membership, role] = await Promise.all([
      this.prisma.partnerMembership.findUnique({ where: { partnerId_userId: { partnerId, userId } } }),
      this.prisma.userRole.findFirst({ where: { partnerId, userId } }),
    ]);
    return !!membership || !!role;
  }

  /**
   * Toggles trading on or off for a partner that has already been through
   * onboarding. Keeps `status` in step with `isActive` — ACTIVE while
   * trading, SUSPENDED while switched off — so the two never disagree about
   * whether a partner may transact.
   *
   * Refuses a partner still `PENDING_APPROVAL` or already `REJECTED`: those
   * have their own transitions (`approve`/`reject`), and silently accepting
   * either here would let a stray admin call activate a partner nobody
   * approved, or "suspend" one that was never trading in the first place.
   */
  async setActive(id: string, isActive: boolean) {
    const partner = await this.findByIdOrThrow(id);
    if (partner.status === PartnerStatus.PENDING_APPROVAL || partner.status === PartnerStatus.REJECTED) {
      throw new ConflictException(
        `A partner with status ${partner.status} must go through approve/reject, not active/suspend`,
      );
    }
    return this.prisma.partner.update({
      where: { id },
      data: {
        isActive,
        status: isActive ? PartnerStatus.ACTIVE : PartnerStatus.SUSPENDED,
      },
    });
  }

  /**
   * The branches a customer could walk into from where they are standing.
   *
   * ## Why a bounding box rather than a real geo query
   *
   * The same reasoning as `EvStationsService.listNearby`, and the same
   * arithmetic, so the two screens cannot disagree about what "nearby" means.
   * A degree of latitude is ~111km everywhere; a degree of longitude shrinks
   * with the cosine of the latitude. That gives a rectangle, which over-selects
   * at the corners — so the exact distance is computed afterwards and anything
   * outside the radius is dropped. The result is a circle, from an index-using
   * query.
   *
   * PostGIS would do this properly. At the number of partners a city has it
   * would also be a dependency, an extension to install and a migration to
   * write, for a query that already returns in single-digit milliseconds.
   * Worth revisiting at a few thousand branches; noted in the audit rather
   * than pretended about.
   *
   * ## What is deliberately not here
   *
   * Inactive partners. A shop that has left the programme still has a branch
   * row — the transactions against it must keep resolving — but sending
   * somebody there to earn points they will not get is worse than not showing
   * it at all.
   */
  async listNearbyBranches(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    category?: string;
    /**
     * The "fuel" chip's own sub-filter. When present it overrides `category`
     * to `'fuel'` — see `NearbyPartnersQueryDto.fuelType`'s own doc comment.
     */
    fuelType?: FuelType;
    q?: string;
    /** The signed-in customer, if any — see `recommendedCategoriesFor`. */
    customerId?: string;
  }): Promise<NearbyPartner[]> {
    const { lat, lng, radiusKm, category, fuelType, q, customerId } = params;
    const recommendedCategories = customerId
      ? await this.recommendedCategoriesFor(customerId)
      : [];
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const branches = await this.prisma.partnerBranch.findMany({
      where: {
        isActive: true,
        latitude: { gte: lat - latDelta, lte: lat + latDelta },
        longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
        partner: {
          isActive: true,
          ...(fuelType
            ? { category: 'fuel', ...(fuelType === 'gas' ? { sellsGas: true } : { sellsPetrol: true }) }
            : category
              ? { category }
              : {}),
        },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { address: { contains: q, mode: 'insensitive' as const } },
                { partner: { displayName: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      // Exactly the customer-visible fields, listed rather than spread. The
      // last time a customer-facing endpoint returned a whole row it leaked an
      // idempotency key to merchants — see F-19.
      select: {
        id: true,
        partnerId: true,
        name: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
        partner: {
          select: {
            displayName: true,
            category: true,
            sellsGas: true,
            sellsPetrol: true,
            bonusAccrualRateBps: true,
            logoAsset: true,
            coverAsset: true,
          },
        },
      },
      // A generous ceiling: enough that a dense city centre is not silently
      // truncated, small enough that a bad radius cannot return a country.
      take: 300,
    });

    return branches
      .map((b) => {
        const branchCategory = toPartnerCategory(b.partner.category);
        return {
          id: b.id,
          partnerId: b.partnerId,
          name: b.partner.displayName,
          branchName: b.name,
          category: branchCategory,
          address: b.address,
          city: b.city,
          latitude: b.latitude,
          longitude: b.longitude,
          // Basis points to percent here, not in the client. A client that
          // forgot to divide would advertise 300% cashback.
          cashbackPercent: b.partner.bonusAccrualRateBps / 100,
          distanceKm: haversineKm(lat, lng, b.latitude, b.longitude),
          logo: this.media.currentPartnerImage(b.partner.logoAsset),
          cover: this.media.currentPartnerImage(b.partner.coverAsset),
          sellsGas: b.partner.sellsGas,
          sellsPetrol: b.partner.sellsPetrol,
          recommended: recommendedCategories.includes(branchCategory),
        };
      })
      .filter((b) => b.distanceKm <= radiusKm)
      // Recommended first, nearest first within each group — personalising
      // this list reorders it, it never hides anything that was already on it.
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.distanceKm - b.distanceKm);
  }

  /**
   * The customer's own top purchase categories, or an empty list when
   * personalisation does not apply — no consent, or not enough history to
   * mean anything yet. Computed fresh on every call: nothing about this is
   * cached or stored beyond the one consent flag on `User`, so turning the
   * setting off takes effect on the very next request.
   *
   * `MIN_PURCHASES_FOR_RECOMMENDATION` exists because a single purchase is
   * not a preference — someone who bought fuel once while passing through
   * should not have their whole map reordered around it.
   */
  private async recommendedCategoriesFor(customerId: string): Promise<PartnerCategory[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { personalizedRecommendationsConsent: true },
    });
    if (!user?.personalizedRecommendationsConsent) return [];

    const counts = await this.transactions.completedPurchaseCategoryCounts(customerId);
    return counts
      .filter((c) => c.count >= MIN_PURCHASES_FOR_RECOMMENDATION)
      .slice(0, MAX_RECOMMENDED_CATEGORIES)
      .map((c) => toPartnerCategory(c.category));
  }
}
