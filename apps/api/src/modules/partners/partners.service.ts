import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';

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
}
