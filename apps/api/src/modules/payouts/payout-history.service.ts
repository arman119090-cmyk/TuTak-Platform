import { Injectable } from '@nestjs/common';
import { Currency, LedgerAccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Reads what a partner is owed and what the retired payout path once paid.
 *
 * This file used to be `PayoutEngineService`: request → `BANK_CLEARING` →
 * confirm, a per-amount transfer engine of its own. It was retired on
 * 26.09.2026 (Launch Readiness, P1) because it was a *second* path out of
 * `PARTNER_PAYABLE`, independent of `PartnerSettlementService`. The two did
 * not know about each other: a legacy payout debited the payable, but the
 * settlement engine claims only `SETTLEABLE_LEDGER_KINDS` and ignored that
 * debit, so a partner paid 30,000 by the legacy path was drafted, approved
 * and paid the same 30,000 again by a settlement — payable at −30,000, and
 * every step of it individually correct. Two authoritative payers is one too
 * many; the settlement engine is the one that stays
 * (docs/PARTNER_COMMERCE.md §14).
 *
 * What remains is read-only: the payable figure the dashboards show, and the
 * `Payout` rows the old path wrote, which are history a partner and an
 * auditor may still need to see. Nothing here posts, claims or transfers.
 */
@Injectable()
export class PayoutHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** What the platform currently owes this partner, as a positive figure. */
  async availableBalance(partnerId: string, currency: Currency = Currency.AMD): Promise<Decimal> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type: LedgerAccountType.PARTNER_PAYABLE, partnerId, currency },
    });
    if (!account) return new Decimal(0);
    // Credit-normal: a payable of 9,750 is stored as -9,750.
    return account.balance.negated();
  }

  /**
   * A partner's legacy payouts, with the two-person rule's participants named.
   *
   * The ids are resolved to names here rather than in the dashboard because
   * whoever reads this history is asking who moved the money, and nobody
   * recognises a UUID. Users are fetched in one query rather than per row.
   */
  async listForPartner(partnerId: string, limit = 30) {
    const payouts = await this.prisma.payout.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const actorIds = [
      ...new Set(
        payouts
          .flatMap((p) => [p.requestedByUserId, p.confirmedByUserId])
          .filter((id): id is string => !!id),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(actors.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return payouts.map((p) => ({
      ...p,
      // Null when nobody is recorded; the raw id when the actor is not a
      // user row (a script, or a seeded fixture) — which is itself worth
      // seeing rather than hiding behind a dash.
      requestedByName: p.requestedByUserId
        ? (nameOf.get(p.requestedByUserId) ?? p.requestedByUserId)
        : null,
      confirmedByName: p.confirmedByUserId
        ? (nameOf.get(p.confirmedByUserId) ?? p.confirmedByUserId)
        : null,
    }));
  }
}
