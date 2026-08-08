/**
 * Fills a local stack with data you can actually click through.
 *
 * `prisma/seed.ts` creates the bare minimum a deployment needs — roles,
 * permissions, one super admin. That is correct for production and useless
 * for testing: every screen renders an empty state, so nothing can be
 * judged. This script is the other half. It creates partners, customers, EV
 * stations, and then drives real money through the real engines so the
 * finance screens have balances that add up rather than fixtures that were
 * typed to look plausible.
 *
 * Nothing here writes a money row directly. Payments go through
 * PaymentEngineService, refunds through RefundEngineService, settlements
 * through the outbox exactly as they do in production — which means if any
 * invariant in those engines is broken, this script fails instead of
 * papering over it with hand-written rows.
 *
 * Refuses to run without TUTAK_DEMO=1, because it also relaxes the
 * bootstrap-password rotation flag (docs/AUDIT_2026-08-B.md §C2) so the
 * seeded accounts can be logged into and used. That is the right trade for
 * a throwaway local stack and the wrong one everywhere else.
 *
 * Safe to run twice: it detects its own marker partner and stops.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  Currency,
  EvConnectorStatus,
  EvConnectorType,
  QrCodeType,
  RoleName,
  type Partner,
  type User,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { QrPaymentsService } from '../modules/qr-payments/qr-payments.service';
import { PaymentEngineService } from '../modules/payments/payment-engine.service';
import { RefundEngineService } from '../modules/payments/refund-engine.service';
import { PayoutEngineService } from '../modules/payouts/payout-engine.service';
import { AcquirerSettlementService } from '../modules/payouts/acquirer-settlement.service';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';
import { OutboxService } from '../modules/ledger/outbox.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { BonusEngineService } from '../modules/wallet/bonus-engine.service';
import { SANDBOX_TOKENS } from '../modules/payments/sandbox-psp.adapter';
import type { RequestUser } from '../modules/auth/types/request-user.type';

const log = new Logger('seed-demo');

/** The partner whose existence means this script already ran. */
const MARKER_TAX_ID = 'DEMO-00000001';

const PARTNERS = [
  {
    taxId: MARKER_TAX_ID,
    legalName: 'Կաֆե Երևան ՍՊԸ',
    displayName: 'Cafe Yerevan',
    category: 'restaurant',
    bonusAccrualRateBps: 500,
    paymentCommissionRateBps: 250,
  },
  {
    taxId: 'DEMO-00000002',
    legalName: 'ՏուՏակ Մարկետ ՍՊԸ',
    displayName: 'TuTak Market',
    category: 'grocery',
    bonusAccrualRateBps: 200,
    paymentCommissionRateBps: 180,
  },
  {
    taxId: 'DEMO-00000003',
    legalName: 'ԷլեկտրոԳՈ ՓԲԸ',
    displayName: 'ElectroGo Charging',
    category: 'ev_charging',
    bonusAccrualRateBps: 300,
    paymentCommissionRateBps: 400,
  },
  {
    taxId: 'DEMO-00000004',
    legalName: 'Արարատ Ֆարմ ՍՊԸ',
    displayName: 'Ararat Pharm',
    category: 'pharmacy',
    bonusAccrualRateBps: 400,
    paymentCommissionRateBps: 220,
  },
] as const;

const CUSTOMERS = [
  { phone: '+37477100001', firstName: 'Ani', lastName: 'Petrosyan', locale: 'hy' },
  { phone: '+37477100002', firstName: 'Davit', lastName: 'Sargsyan', locale: 'ru' },
  { phone: '+37477100003', firstName: 'Mery', lastName: 'Hakobyan', locale: 'en' },
  { phone: '+37477100004', firstName: 'Narek', lastName: 'Grigoryan', locale: 'hy' },
] as const;

/**
 * Accounts the end-to-end suite owns, and nothing else touches.
 *
 * Velocity limiting refuses a customer's ninth transaction in ten minutes,
 * which is correct and which a test suite reaches quickly if it shares an
 * account with the seeded demo history. Giving the suite its own accounts —
 * and one per spec — keeps every run well under the limit without loosening
 * the rule that a real customer is protected by.
 */
const E2E_CUSTOMERS = [
  { phone: '+37477190001', firstName: 'E2E', lastName: 'One', locale: 'en' },
  { phone: '+37477190002', firstName: 'E2E', lastName: 'Two', locale: 'en' },
  { phone: '+37477190003', firstName: 'E2E', lastName: 'Three', locale: 'en' },
  { phone: '+37477190004', firstName: 'E2E', lastName: 'Four', locale: 'en' },
  { phone: '+37477190005', firstName: 'E2E', lastName: 'Five', locale: 'en' },
] as const;

async function main() {
  if (process.env.TUTAK_DEMO !== '1') {
    throw new Error(
      'Refusing to run: set TUTAK_DEMO=1 to confirm this is a throwaway local stack. ' +
        'This seeder creates logins with a shared password and clears the ' +
        'must-change-password flag, which must never happen on a real deployment.',
    );
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('DEMO_PASSWORD must be set to at least 12 characters.');
  }

  // A seeder is not a worker. Left on, this process would start its own
  // BullMQ worker and race the drain calls below for the events it just
  // wrote — which does no harm, but makes a script that asserts ledger state
  // depend on timing. The API container's worker is the one that should be
  // draining.
  process.env.SWEEPS_ENABLED = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const qrPayments = app.get(QrPaymentsService);
  const payments = app.get(PaymentEngineService);
  const refunds = app.get(RefundEngineService);
  const payouts = app.get(PayoutEngineService);
  const acquirerSettlements = app.get(AcquirerSettlementService);
  const reconciliation = app.get(ReconciliationService);
  const outbox = app.get(OutboxService);
  const ledger = app.get(LedgerService);
  const bonus = app.get(BonusEngineService);

  const already = await prisma.partner.findUnique({ where: { taxId: MARKER_TAX_ID } });
  if (already) {
    log.log('Demo data is already present — nothing to do.');
    await app.close();
    return;
  }

  const passwordHash = await argon2.hash(password);

  // ── People ─────────────────────────────────────────────────────────────

  /**
   * Creates a login that works immediately.
   *
   * `mustChangePassword: false` is the deliberate relaxation this whole
   * script is gated behind: a bootstrap credential normally reaches login
   * and nothing else, which would leave every demo account staring at a
   * password-rotation wall.
   */
  const createUser = async (u: {
    phone: string;
    firstName: string;
    lastName: string;
    locale?: string;
    verified?: boolean;
  }): Promise<User> =>
    prisma.user.create({
      data: {
        phone: u.phone,
        firstName: u.firstName,
        lastName: u.lastName,
        locale: u.locale ?? 'hy',
        passwordHash,
        // Earning is gated on a verified phone; an unverified demo customer
        // would silently accrue nothing and look like a bug.
        isPhoneVerified: u.verified ?? true,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        wallet: { create: {} },
        referralCode: { create: { code: `TT-${u.phone.slice(-6)}` } },
      },
    });

  const grantRole = async (userId: string, roleName: RoleName, partnerId?: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const existing = await prisma.userRole.findFirst({
      where: { userId, roleId: role.id, partnerId: partnerId ?? null },
    });
    if (!existing) {
      await prisma.userRole.create({ data: { userId, roleId: role.id, partnerId } });
    }
  };

  log.log('Creating partners…');
  const partners: Partner[] = [];
  for (const p of PARTNERS) {
    partners.push(await prisma.partner.create({ data: { ...p } }));
  }
  // Money below flows through the first two only. The other two exist so the
  // partner list, the branch list and the EV map have rows that no payment
  // in this script has touched.
  const [cafe, market, electro, pharm] = partners as [Partner, Partner, Partner, Partner];

  log.log('Creating branches…');
  await prisma.partnerBranch.createMany({
    data: [
      { partnerId: cafe.id, name: 'Cafe Yerevan — Northern Ave', address: 'Հյուսիսային պող. 12', city: 'Yerevan', latitude: 40.1826, longitude: 44.5145 },
      { partnerId: cafe.id, name: 'Cafe Yerevan — Cascade', address: 'Թամանյան 5', city: 'Yerevan', latitude: 40.1899, longitude: 44.5153 },
      { partnerId: market.id, name: 'TuTak Market — Arabkir', address: 'Կոմիտաս 42', city: 'Yerevan', latitude: 40.2044, longitude: 44.4989 },
      { partnerId: pharm.id, name: 'Ararat Pharm — Gyumri', address: 'Շիրակացի 8', city: 'Gyumri', latitude: 40.7894, longitude: 43.8475 },
    ],
  });

  log.log('Creating EV stations…');
  for (const station of [
    { name: 'ElectroGo — Republic Square', address: 'Հանրապետության հրապարակ', city: 'Yerevan', latitude: 40.1776, longitude: 44.5126 },
    { name: 'ElectroGo — Sevan Highway', address: 'Մ4 խճուղի, 42 կմ', city: 'Sevan', latitude: 40.5535, longitude: 44.9511 },
    { name: 'ElectroGo — Dilijan', address: 'Կալինինի 3', city: 'Dilijan', latitude: 40.7408, longitude: 44.8631 },
  ]) {
    const created = await prisma.evStation.create({
      data: { ...station, partnerId: electro.id },
    });
    await prisma.evConnector.createMany({
      data: [
        {
          stationId: created.id,
          connectorType: EvConnectorType.CCS2,
          status: EvConnectorStatus.AVAILABLE,
          powerKw: new Decimal('60.00'),
          pricePerKwh: new Decimal('95.00'),
        },
        {
          stationId: created.id,
          connectorType: EvConnectorType.TYPE_2,
          status: EvConnectorStatus.AVAILABLE,
          powerKw: new Decimal('22.00'),
          pricePerKwh: new Decimal('70.00'),
        },
      ],
    });
  }

  log.log('Creating customers and partner staff…');
  const customers: User[] = [];
  for (const c of CUSTOMERS) {
    const user = await createUser(c);
    await grantRole(user.id, RoleName.CUSTOMER);
    customers.push(user);
  }

  // Created, then deliberately left out of everything below: the suite that
  // uses them needs their transaction history to be its own.
  for (const c of E2E_CUSTOMERS) {
    const user = await createUser(c);
    await grantRole(user.id, RoleName.CUSTOMER);
  }

  // The partner dashboard resolves "my partner" from a partner-scoped role.
  // Scoping the owner to the same partner the money below flows through is
  // what makes the earnings screen show numbers instead of zeros.
  const owner = await createUser({
    phone: '+37477200001',
    firstName: 'Gor',
    lastName: 'Manukyan',
  });
  await grantRole(owner.id, RoleName.PARTNER_OWNER, cafe.id);
  await prisma.partnerMembership.create({ data: { partnerId: cafe.id, userId: owner.id } });

  const staff = await createUser({
    phone: '+37477200002',
    firstName: 'Lilit',
    lastName: 'Avetisyan',
  });
  await grantRole(staff.id, RoleName.PARTNER_STAFF, cafe.id);
  await prisma.partnerMembership.create({ data: { partnerId: cafe.id, userId: staff.id } });

  const marketOwner = await createUser({
    phone: '+37477200003',
    firstName: 'Armen',
    lastName: 'Khachatryan',
  });
  await grantRole(marketOwner.id, RoleName.PARTNER_OWNER, market.id);
  await prisma.partnerMembership.create({
    data: { partnerId: market.id, userId: marketOwner.id },
  });

  // The seeded super admin is a bootstrap credential by design. For a local
  // stack it also has to be a usable one, or none of the admin screens can
  // be opened at all.
  const admin = await prisma.user.findUnique({ where: { phone: '+37400000000' } });
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });
    log.log('Super admin password aligned with DEMO_PASSWORD.');
  }

  // A second administrator, so the demo can actually exercise the two-person
  // rule on payouts. With one admin the rule is invisible — and a control
  // nobody has seen working is a control nobody trusts when it fires.
  //
  // SUPER_ADMIN, not ADMIN: confirming a payout needs PAYOUT_MANAGE, which
  // is deliberately not granted to ADMIN because wiring money to an external
  // account is the least reversible action here. The consequence is worth
  // stating plainly — running with dual control means the business needs
  // *two* super administrators, or no payout can ever be confirmed. An ADMIN
  // approver looks like it should work and is refused by the permission
  // guard before the two-person rule is even reached.
  const approver = await prisma.user.upsert({
    where: { phone: '+37400000001' },
    update: { passwordHash, mustChangePassword: false },
    create: {
      phone: '+37400000001',
      firstName: 'Nune',
      lastName: 'Approver',
      passwordHash,
      isPhoneVerified: true,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });
  await grantRole(approver.id, RoleName.SUPER_ADMIN);
  log.log('Second administrator created for payout approval.');

  // ── QR payments: the loyalty loop ──────────────────────────────────────

  const asRequestUser = (user: User, roles: RoleName[], scopes: Record<string, string[]> = {}): RequestUser => ({
    id: user.id,
    phone: user.phone,
    roles,
    permissions: [],
    partnerScopes: scopes,
    mustChangePassword: false,
  });

  const staffActor = asRequestUser(staff, [RoleName.PARTNER_STAFF], {
    PARTNER_STAFF: [cafe.id],
  });

  log.log('Running QR redemptions…');
  let qrSeq = 0;
  const redeem = async (customer: User, partnerId: string, amount: string, applyBonus?: string) => {
    const qr = await qrPayments.issue(
      {
        type: QrCodeType.DYNAMIC_INVOICE,
        partnerId,
        amount,
        expiresInSeconds: 900,
      },
      staffActor,
    );
    qrSeq += 1;
    return qrPayments.redeem(
      {
        token: qr.token,
        idempotencyKey: `demo-qr-${qrSeq}`,
        ...(applyBonus ? { bonusAmountToApply: applyBonus } : {}),
      },
      customer.id,
    );
  };

  // First pass: everyone pays cash and earns points.
  for (const [i, customer] of customers.entries()) {
    await redeem(customer, cafe.id, String(4_500 + i * 1_800));
  }

  // Those points land PENDING behind a cooling-off window. Fast-forward it
  // so the wallet screens show a spendable balance rather than a promise.
  await bonus.promotePendingLots(new Date(Date.now() + 90 * 24 * 3_600_000));

  // Second pass: two of them spend some of what they just earned, which is
  // the part of the loop worth looking at.
  await redeem(customers[0]!, cafe.id, '6200', '150');
  await redeem(customers[1]!, cafe.id, '3400', '200');

  await bonus.promotePendingLots(new Date(Date.now() + 90 * 24 * 3_600_000));

  // ── Card payments: the financial core ──────────────────────────────────

  log.log('Capturing card payments…');
  const captured: string[] = [];
  for (const [i, amount] of ['12000', '8500', '31000', '4700', '19900'].entries()) {
    const result = await payments.capture({
      userId: customers[i % customers.length]!.id,
      partnerId: cafe.id,
      amount,
      sourceToken: 'tok_demo_visa',
      idempotencyKey: `demo-pay-${i}`,
    });
    captured.push(result.paymentId);
  }

  // A couple through the second partner, so the ledger has more than one
  // partner account and the reconciliation screen has something to compare.
  for (const [i, amount] of ['5600', '14300'].entries()) {
    await payments.capture({
      userId: customers[i]!.id,
      partnerId: market.id,
      amount,
      sourceToken: 'tok_demo_visa',
      idempotencyKey: `demo-pay-market-${i}`,
    });
  }

  // One decline, so the payments list is not uniformly happy.
  await payments.capture({
    userId: customers[2]!.id,
    partnerId: cafe.id,
    amount: '9900',
    sourceToken: SANDBOX_TOKENS.DECLINE_INSUFFICIENT_FUNDS,
    idempotencyKey: 'demo-pay-declined',
  });

  // Settlement is driven by the outbox, not by capture. Draining it here
  // rather than waiting on the cron means the seeder finishes in a state a
  // human can inspect immediately.
  log.log('Draining the outbox to settle captured payments…');
  for (let i = 0; i < 5; i += 1) {
    const drained = await outbox.drain();
    if (drained === 0) break;
  }
  await bonus.promotePendingLots(new Date(Date.now() + 90 * 24 * 3_600_000));

  log.log('Issuing a partial refund…');
  await refunds.refund({
    paymentId: captured[0]!,
    amount: '3000',
    reason: 'Customer returned one item',
    actorId: admin?.id ?? owner.id,
    idempotencyKey: 'demo-refund-1',
  });

  log.log('Requesting a payout…');
  const available = await payouts.availableBalance(cafe.id);
  const payoutAmount = available.greaterThan(20_000) ? new Decimal('20000') : available.dividedBy(2);
  if (payoutAmount.greaterThan(0)) {
    const payout = await payouts.requestPayout({
      partnerId: cafe.id,
      amount: payoutAmount.toFixed(4),
      actorId: admin?.id ?? owner.id,
      idempotencyKey: 'demo-payout-1',
    });
    // Confirmed by the *other* administrator. Passing the requester here
    // would be rejected by the engine, which is the point: the demo data
    // could not have been produced by one person acting alone.
    await payouts.confirmPaid(payout.payoutId, 'DEMO-WIRE-000117', approver.id);
  }

  // ── The acquirer pays us ───────────────────────────────────────────────
  //
  // Deliberately partial. A remittance that cleared the whole receivable
  // would leave the ledger looking tidier than a real one ever does — the
  // acquirer settles on its own schedule, and there is always something in
  // flight.

  log.log('Recording an acquirer remittance…');
  const receivable = await acquirerSettlements.outstandingReceivable();
  const remittance = receivable.times(0.6).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  if (remittance.greaterThan(0)) {
    await acquirerSettlements.record({
      amount: remittance.toFixed(4),
      reference: 'DEMO-REMIT-000401',
      settledOn: new Date(Date.now() - 24 * 3_600_000),
      actorId: admin?.id ?? owner.id,
      idempotencyKey: 'demo-acquirer-1',
    });
  }

  // ── Reconciliation ─────────────────────────────────────────────────────
  //
  // Two runs on purpose. The first reports exactly what the ledger holds, so
  // it matches — the healthy case. The second reports a small discrepancy
  // against the *second* partner, so the screen shows what a real drift
  // looks like and the payout block it triggers, without blocking the
  // partner everything else in this demo runs through.

  const balanceOf = async (type: 'PSP_RECEIVABLE' | 'PARTNER_PAYABLE', partnerId?: string) => {
    const account = await prisma.ledgerAccount.findFirst({
      where: { type, partnerId: partnerId ?? null, currency: Currency.AMD },
    });
    return account ? account.balance : new Decimal(0);
  };

  const midnight = (daysAgo: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d;
  };

  log.log('Running reconciliation…');
  // Partner payables are credit-normal, so the ledger stores them negative;
  // a bank reporting what it owes states the same number positive.
  const cafePayable = (await balanceOf('PARTNER_PAYABLE', cafe.id)).negated();
  const marketPayable = (await balanceOf('PARTNER_PAYABLE', market.id)).negated();
  const pspReceivable = await balanceOf('PSP_RECEIVABLE');

  await reconciliation.reconcile({
    periodStart: midnight(1),
    pspReceivable,
    partnerPayables: [
      { partnerId: cafe.id, amount: cafePayable },
      { partnerId: market.id, amount: marketPayable },
    ],
  });

  await reconciliation.reconcile({
    periodStart: midnight(0),
    pspReceivable,
    partnerPayables: [
      { partnerId: cafe.id, amount: cafePayable },
      // 1,250 AMD the bank says it owes and the ledger does not — enough to
      // block this partner's payouts and nothing else.
      { partnerId: market.id, amount: marketPayable.plus(1_250) },
    ],
  });

  // ── Report ─────────────────────────────────────────────────────────────

  const accounts = await prisma.ledgerAccount.findMany({ orderBy: { type: 'asc' } });
  let total = new Decimal(0);
  for (const account of accounts) {
    total = total.plus(account.balance);
    const replayed = await ledger.replayBalance(account.id);
    const flag = replayed.equals(account.balance) ? 'ok' : 'DRIFT';
    log.log(`  ${account.type.padEnd(18)} ${account.balance.toFixed(4).padStart(16)}  ${flag}`);
  }
  log.log(`  ${'TOTAL'.padEnd(18)} ${total.toFixed(4).padStart(16)}`);
  if (!total.isZero()) {
    throw new Error(
      `Double-entry invariant broken: all accounts sum to ${total.toFixed(4)}, expected 0.`,
    );
  }

  const counts = {
    partners: await prisma.partner.count(),
    users: await prisma.user.count(),
    payments: await prisma.payment.count(),
    settlements: await prisma.settlement.count(),
    refunds: await prisma.refund.count(),
    payouts: await prisma.payout.count(),
    transactions: await prisma.transaction.count(),
    evStations: await prisma.evStation.count(),
    reconciliationRuns: await prisma.reconciliationRun.count(),
  };
  log.log(`Demo data ready: ${JSON.stringify(counts)}`);

  await app.close();
}

main()
  .then(() => {
    // `app.close()` shuts the modules down but does not drain the Redis
    // connection pool or the scheduler's timers, so the event loop stays
    // alive and the process never exits on its own. A seeder that hangs
    // after succeeding looks exactly like a seeder that failed.
    process.exit(0);
  })
  .catch((err) => {
    log.error(
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err.stack : undefined,
    );
    process.exit(1);
  });
