import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ROAMING_CPO_PROVIDER, RoamingCpoProvider } from './roaming-cpo-provider.interface';

/**
 * The User ↔ roaming-CPO-customer-id mapping.
 *
 * `link()` is no longer reachable over HTTP by a customer —
 * docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md, Problem 3: a
 * customer typing in an arbitrary `externalCustomerId` and having it bound
 * immediately had no proof the id was ever theirs, letting anyone with a
 * guessed/leaked one attach a stranger's charging history and bonus
 * accrual to their own TuTak account. The TuTak User ID is the identity;
 * an external id is only ever attached via a trusted server-to-server
 * handshake, which is what calling this method now represents — every link
 * it creates is stamped `verifiedAt` immediately, and
 * `RoamingCpoSettlementService` refuses to settle against any link that
 * isn't (see that service and `RoamingCustomerLink`'s own docblock for the
 * quarantine this replaced). There is deliberately no customer-facing route
 * left that reaches this method with attacker-controlled input.
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
        data: { partnerId, externalCustomerId, userId, verifiedAt: new Date() },
      }));

    // Requirement 4: "what TuTak needs to send back — the linked TuTak user
    // id, at minimum". Best-effort and outside the write above: the
    // provider not yet having anywhere to receive this must never block the
    // handshake that created the mapping.
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
