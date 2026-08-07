import { LedgerAccountType, PrismaClient, QrCodeType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { QrLedgerMirrorService } from '../src/modules/qr-payments/qr-ledger-mirror.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { createCustomer, createDynamicInvoiceQr, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Phase 4 dual-write.
 *
 * The property under test is mostly restraint: the mirror must record the
 * same money in the ledger *without* being able to affect the path that
 * actually serves the customer. So these tests check that it stays silent
 * when off, balances when on, and — the one that matters most — that a
 * mirror which blows up does not take a customer's payment down with it.
 */
describe('QrLedgerMirrorService (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let mirror: QrLedgerMirrorService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    ledger = harness.app.get(LedgerService);
    mirror = harness.app.get(QrLedgerMirrorService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  /** Forces the flag on for one test without touching global config. */
  const withMirrorEnabled = () =>
    jest.spyOn(mirror, 'enabled', 'get').mockReturnValue(true);

  const balanceOf = async (type: LedgerAccountType, partnerId?: string): Promise<string> => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null },
    });
    return (account?.balance ?? new Decimal(0)).toFixed(4);
  };

  it('is off by default, so nothing is written', async () => {
    const partner = await createPartner(prisma);
    expect(mirror.enabled).toBe(false);

    await mirror.mirror({
      transactionId: 'tx-off',
      partnerId: partner.id,
      amount: new Decimal('10000'),
      bonusApplied: new Decimal(0),
    });

    expect(await prisma.ledgerTransaction.count()).toBe(0);
    expect(await prisma.ledgerAccount.count()).toBe(0);
  });

  it('posts a balanced transaction for a cash-only payment', async () => {
    withMirrorEnabled();
    const partner = await createPartner(prisma);

    await mirror.mirror({
      transactionId: 'tx-cash',
      partnerId: partner.id,
      amount: new Decimal('10000'),
      bonusApplied: new Decimal(0),
    });

    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('10000.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('-10000.0000');

    const tx = await prisma.ledgerTransaction.findFirstOrThrow({ include: { postings: true } });
    expect(tx.kind).toBe('qr.redeemed.mirror');
    const net = tx.postings.reduce(
      (acc, p) => acc + (p.direction === 'DEBIT' ? 1 : -1) * Number(p.amount),
      0,
    );
    expect(net).toBe(0);
  });

  it('splits a part-bonus payment between cash in and liability released', async () => {
    withMirrorEnabled();
    const partner = await createPartner(prisma);

    // 10,000 charged, 2,000 of it paid with points.
    await mirror.mirror({
      transactionId: 'tx-split',
      partnerId: partner.id,
      amount: new Decimal('10000'),
      bonusApplied: new Decimal('2000'),
    });

    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('8000.0000');
    // Points spent release the liability the platform carried for them.
    expect(await balanceOf(LedgerAccountType.BONUS_LIABILITY)).toBe('2000.0000');
    expect(await balanceOf(LedgerAccountType.PARTNER_PAYABLE, partner.id)).toBe('-10000.0000');
  });

  it('writes nothing when the payment was settled entirely in points', async () => {
    withMirrorEnabled();
    const partner = await createPartner(prisma);

    // No money changed hands between customer, acquirer and partner — only
    // the bonus ledger has anything to say, and it already said it.
    await mirror.mirror({
      transactionId: 'tx-all-points',
      partnerId: partner.id,
      amount: new Decimal('5000'),
      bonusApplied: new Decimal('5000'),
    });

    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('keeps the materialized balance equal to a replay of its postings', async () => {
    withMirrorEnabled();
    const partner = await createPartner(prisma);

    for (const [i, amount] of ['1000', '2500', '400'].entries()) {
      await mirror.mirror({
        transactionId: `tx-replay-${i}`,
        partnerId: partner.id,
        amount: new Decimal(amount),
        bonusApplied: new Decimal(0),
      });
    }

    for (const account of await prisma.ledgerAccount.findMany()) {
      const replayed = await ledger.replayBalance(account.id);
      expect(account.balance.toFixed(4)).toBe(replayed.toFixed(4));
    }
  });

  // ── The property that makes this safe to switch on ────────────────────

  it('swallows its own failure rather than surfacing it', async () => {
    withMirrorEnabled();
    const partner = await createPartner(prisma);
    jest.spyOn(ledger, 'post').mockRejectedValue(new Error('ledger unavailable'));

    // A shadow write must never be able to fail the real one.
    await expect(
      mirror.mirror({
        transactionId: 'tx-broken',
        partnerId: partner.id,
        amount: new Decimal('1000'),
        bonusApplied: new Decimal(0),
      }),
    ).resolves.toBeUndefined();
  });

  it('does not fail a real QR redemption when the mirror is broken', async () => {
    // The end-to-end version of the same guarantee, through the actual
    // redemption path rather than the mirror in isolation.
    withMirrorEnabled();
    jest.spyOn(ledger, 'post').mockRejectedValue(new Error('ledger unavailable'));

    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

    const qrPayments = harness.app.get(
      (await import('../src/modules/qr-payments/qr-payments.service')).QrPaymentsService,
    );

    const result = await qrPayments.redeem(
      { token: qr.token, idempotencyKey: 'mirror-failure-1' },
      user.id,
    );

    expect(result.amountCharged).toBe('5000');
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transactionId } });
    expect(tx.status).toBe('COMPLETED');
  });

  it('mirrors a real redemption end to end when enabled', async () => {
    withMirrorEnabled();
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const qr = await createDynamicInvoiceQr(prisma, { partnerId: partner.id, amount: '5000' });

    const qrPayments = harness.app.get(
      (await import('../src/modules/qr-payments/qr-payments.service')).QrPaymentsService,
    );
    const result = await qrPayments.redeem(
      { token: qr.token, idempotencyKey: 'mirror-e2e-1' },
      user.id,
    );

    const mirrored = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'qr.redeemed.mirror' },
    });
    expect(mirrored.sourceId).toBe(result.transactionId);
    expect(await balanceOf(LedgerAccountType.PSP_RECEIVABLE)).toBe('5000.0000');
  });

  it('does not mirror a STATIC_MERCHANT redemption, because that path is refused', async () => {
    withMirrorEnabled();
    const { user } = await createCustomer(prisma);
    const partner = await createPartner(prisma);
    const qr = await prisma.qrCode.create({
      data: {
        type: QrCodeType.STATIC_MERCHANT,
        token: 'static-mirror-token',
        partnerId: partner.id,
        amount: new Decimal('9000'),
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const qrPayments = harness.app.get(
      (await import('../src/modules/qr-payments/qr-payments.service')).QrPaymentsService,
    );

    await expect(
      qrPayments.redeem({ token: qr.token, idempotencyKey: 'mirror-static-1' }, user.id),
    ).rejects.toThrow(/Static merchant codes are not accepted/);

    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });
});
