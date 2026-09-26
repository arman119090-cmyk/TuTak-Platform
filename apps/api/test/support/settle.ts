import { PrismaClient } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { PartnerSettlementService } from '../../src/modules/partner-settlements/partner-settlement.service';
import { createStaffUser } from '../setup/fixtures';

/**
 * Pays a partner everything they are owed, the one way that exists.
 *
 * Until 26.09.2026 most money suites paid a partner through the legacy
 * `PayoutEngineService.requestPayout` + `confirmPaid`. That engine was a
 * second path out of `PARTNER_PAYABLE` the settlement engine did not see —
 * the same earnings could be paid by both — and was retired (Launch
 * Readiness P1). Every suite that used to "pay out" now goes through
 * `PartnerSettlementService` like production does: a draft claims every
 * settleable posting up to now, a second person approves it, and `markPaid`
 * is the single step that posts (`partner.settlement.paid`, DEBIT
 * `PARTNER_PAYABLE` / CREDIT `PLATFORM_BANK`).
 *
 * Two differences from the old helper that callers should know about:
 * - a settlement pays the whole unsettled net, never an amount of your
 *   choosing; a non-positive net is refused ("Nothing to pay") rather than
 *   paid as zero;
 * - the maker and checker must be real users (the audit log has a foreign
 *   key to `users`); pass your own or let this create two staff users;
 * - approval snapshots where the money goes, so a partner without an active
 *   bank account cannot be approved. `payEverything`/`payDraft` record one
 *   for a partner who has none — most money suites create partners with
 *   nothing but a name, and the property they test is not the bank record.
 */
export function settlementSupport(app: TestingModule, prisma: PrismaClient) {
  const engine = app.get(PartnerSettlementService);

  async function actors(given?: { makerId?: string; checkerId?: string }) {
    const makerId = given?.makerId ?? (await createStaffUser(prisma)).id;
    const checkerId = given?.checkerId ?? (await createStaffUser(prisma)).id;
    return { makerId, checkerId };
  }

  /** `approve` refuses a partner with no active bank account; the fixtures rarely have one. */
  async function ensureBankAccount(partnerId: string, createdByUserId: string) {
    const existing = await prisma.partnerBankAccount.findFirst({ where: { partnerId, isActive: true } });
    if (existing) return;
    await prisma.partnerBankAccount.create({
      data: {
        partnerId,
        beneficiaryName: 'Test Partner LLC',
        accountNumber: `AM00 TEST ${partnerId.slice(0, 8)}`,
        bankName: 'Test Bank',
        createdByUserId,
      },
    });
  }

  /** The whole ledger history up to a moment just after now, so a posting made this millisecond is inside. */
  const periodEndingNow = () => ({
    periodStart: new Date('2020-01-01T00:00:00.000Z'),
    periodEnd: new Date(Date.now() + 1000),
  });

  return {
    engine,

    /**
     * Claims everything settleable, gets it approved and marks it paid. The
     * bank reference defaults to something unique per call.
     */
    async payEverything(
      partnerId: string,
      opts: { makerId?: string; checkerId?: string; bankTransferReference?: string } = {},
    ) {
      const { makerId, checkerId } = await actors(opts);
      const draft = await engine.createDraft({ partnerId, actorId: makerId, ...periodEndingNow() });
      await ensureBankAccount(partnerId, makerId);
      await engine.markReady(draft.id, { actorId: makerId });
      await engine.approve(draft.id, checkerId);
      return engine.markPaid(draft.id, {
        actorId: checkerId,
        bankTransferReference: opts.bankTransferReference ?? `BANK-${draft.id.slice(0, 8)}`,
      });
    },

    /** Only the claim: a DRAFT for everything settleable up to now (refused when there is nothing to pay). */
    async draftEverything(partnerId: string, opts: { makerId?: string } = {}) {
      const { makerId } = await actors({ makerId: opts.makerId, checkerId: opts.makerId });
      return engine.createDraft({ partnerId, actorId: makerId, ...periodEndingNow() });
    },

    /** Takes an existing DRAFT the rest of the way: ready → approved → paid. */
    async payDraft(
      draftId: string,
      opts: { makerId: string; checkerId?: string; bankTransferReference?: string },
    ) {
      const { makerId, checkerId } = await actors(opts);
      const draft = await prisma.partnerSettlement.findUniqueOrThrow({ where: { id: draftId }, select: { partnerId: true } });
      await ensureBankAccount(draft.partnerId, makerId);
      await engine.markReady(draftId, { actorId: makerId });
      await engine.approve(draftId, checkerId);
      return engine.markPaid(draftId, {
        actorId: checkerId,
        bankTransferReference: opts.bankTransferReference ?? `BANK-${draftId.slice(0, 8)}`,
      });
    },
  };
}
