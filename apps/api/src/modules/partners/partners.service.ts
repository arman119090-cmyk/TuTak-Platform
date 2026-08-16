import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnerStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isCommissionRateBps } from '../../common/validators/is-commission-rate-bps.validator';
import { ApplyPartnerDto } from './dto/apply-partner.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { haversineKm, toPartnerCategory, type NearbyPartner } from './geo';

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

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

  findById(id: string) {
    return this.prisma.partner.findUnique({ where: { id }, include: { branches: true } });
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
    bonusAccrualRateBps: true,
    isActive: true,
    createdAt: true,
  } as const;

  /** Every partner, in the projection safe for any authenticated caller. */
  listPublic() {
    return this.prisma.partner.findMany({
      select: PartnersService.PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every partner, in full. Callers must hold PARTNER_MANAGE. */
  list() {
    return this.prisma.partner.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** One partner, in the projection safe for any authenticated caller. */
  async findPublicOrThrow(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: PartnersService.PUBLIC_FIELDS,
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
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
    q?: string;
  }): Promise<NearbyPartner[]> {
    const { lat, lng, radiusKm, category, q } = params;
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const branches = await this.prisma.partnerBranch.findMany({
      where: {
        latitude: { gte: lat - latDelta, lte: lat + latDelta },
        longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
        partner: {
          isActive: true,
          ...(category ? { category } : {}),
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
          select: { displayName: true, category: true, bonusAccrualRateBps: true },
        },
      },
      // A generous ceiling: enough that a dense city centre is not silently
      // truncated, small enough that a bad radius cannot return a country.
      take: 300,
    });

    return branches
      .map((b) => ({
        id: b.id,
        partnerId: b.partnerId,
        name: b.partner.displayName,
        branchName: b.name,
        category: toPartnerCategory(b.partner.category),
        address: b.address,
        city: b.city,
        latitude: b.latitude,
        longitude: b.longitude,
        // Basis points to percent here, not in the client. A client that
        // forgot to divide would advertise 300% cashback.
        cashbackPercent: b.partner.bonusAccrualRateBps / 100,
        distanceKm: haversineKm(lat, lng, b.latitude, b.longitude),
      }))
      .filter((b) => b.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
