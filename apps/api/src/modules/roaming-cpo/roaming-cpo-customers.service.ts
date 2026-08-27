import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ROAMING_CPO_PROVIDER, RoamingCpoProvider } from './roaming-cpo-provider.interface';

/**
 * The User ↔ roaming-CPO-customer-id mapping — "TuTak links its own User
 * accounts to the partner's customer IDs (a stored mapping, not inferred)".
 *
 * Deliberately customer-initiated (a logged-in TuTak user names their own
 * external customer id) rather than created implicitly by the settlement
 * webhook: a webhook that could silently create the mapping on first sight
 * would let anyone with a guessed/leaked external customer id attach a
 * stranger's charging history and bonus accrual to their own TuTak account.
 * `RoamingCpoSettlementService` requires the link to already exist and
 * rejects an unlinked customer id — see that service's docblock.
 */
@Injectable()
export class RoamingCpoCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ROAMING_CPO_PROVIDER) private readonly provider: RoamingCpoProvider,
  ) {}

  async link(userId: string, partnerId: string, externalCustomerId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');

    const existing = await this.prisma.roamingCustomerLink.findUnique({
      where: { partnerId_externalCustomerId: { partnerId, externalCustomerId } },
    });
    if (existing && existing.userId !== userId) {
      throw new BadRequestException('This account is already linked to another TuTak user');
    }

    const link =
      existing ??
      (await this.prisma.roamingCustomerLink.create({
        data: { partnerId, externalCustomerId, userId },
      }));

    // Requirement 4: "what TuTak needs to send back — the linked TuTak user
    // id, at minimum". Best-effort and outside the write above: the partner
    // not yet having anywhere to receive this must never block the customer
    // from linking their own account inside TuTak.
    await this.provider
      .notifyCustomerLinked({ partnerId, externalCustomerId, tutakUserId: userId })
      .catch(() => undefined);

    return link;
  }

  async findLink(partnerId: string, externalCustomerId: string) {
    return this.prisma.roamingCustomerLink.findUnique({
      where: { partnerId_externalCustomerId: { partnerId, externalCustomerId } },
    });
  }

  /** Every roaming-CPO account this TuTak user has linked, one per partner. */
  async findLinksForUser(userId: string) {
    return this.prisma.roamingCustomerLink.findMany({ where: { userId } });
  }
}
