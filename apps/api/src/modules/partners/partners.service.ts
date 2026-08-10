import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { haversineKm, toPartnerCategory, type NearbyPartner } from './geo';

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePartnerDto) {
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
        },
      });

      await tx.partnerMembership.create({
        data: { partnerId: partner.id, userId: dto.ownerUserId },
      });

      await tx.userRole.create({
        data: { userId: dto.ownerUserId, roleId: ownerRole.id, partnerId: partner.id },
      });

      return partner;
    });
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

  setActive(id: string, isActive: boolean) {
    return this.prisma.partner.update({ where: { id }, data: { isActive } });
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
