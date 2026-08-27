import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FASTCHARGE_PROVIDER, FastChargeProvider } from './fastcharge-provider.interface';

/**
 * The User ↔ FastCharge-customer-id mapping — "TuTak links its own User
 * accounts to FastCharge's customer IDs (a stored mapping, not inferred)".
 *
 * Deliberately customer-initiated (a logged-in TuTak user names their own
 * FastCharge customer id) rather than created implicitly by the settlement
 * webhook: a webhook that could silently create the mapping on first sight
 * would let anyone with a guessed/leaked FastCharge customer id attach a
 * stranger's charging history and bonus accrual to their own TuTak account.
 * `FastChargeSettlementService` requires the link to already exist and
 * rejects an unlinked customer id — see that service's docblock.
 */
@Injectable()
export class FastChargeCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FASTCHARGE_PROVIDER) private readonly provider: FastChargeProvider,
  ) {}

  async link(userId: string, partnerId: string, fastChargeCustomerId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');

    const existing = await this.prisma.fastChargeCustomerLink.findUnique({
      where: { partnerId_fastChargeCustomerId: { partnerId, fastChargeCustomerId } },
    });
    if (existing && existing.userId !== userId) {
      throw new BadRequestException('This FastCharge account is already linked to another TuTak user');
    }

    const link =
      existing ??
      (await this.prisma.fastChargeCustomerLink.create({
        data: { partnerId, fastChargeCustomerId, userId },
      }));

    // Requirement 4: "what TuTak needs to send back — the linked TuTak user
    // id, at minimum". Best-effort and outside the write above: FastCharge
    // not yet having anywhere to receive this must never block the customer
    // from linking their own account inside TuTak.
    await this.provider
      .notifyCustomerLinked({ partnerId, fastChargeCustomerId, tutakUserId: userId })
      .catch(() => undefined);

    return link;
  }

  async findLink(partnerId: string, fastChargeCustomerId: string) {
    return this.prisma.fastChargeCustomerLink.findUnique({
      where: { partnerId_fastChargeCustomerId: { partnerId, fastChargeCustomerId } },
    });
  }

  /** Every FastCharge account this TuTak user has linked, one per partner. */
  async findLinksForUser(userId: string) {
    return this.prisma.fastChargeCustomerLink.findMany({ where: { userId } });
  }
}
