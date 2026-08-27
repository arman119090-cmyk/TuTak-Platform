import {
  EvConnectorType,
  Partner,
  PrismaClient,
  QrCodeType,
  User,
  Wallet,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Minimal, explicit fixtures. Each builder creates only what the row needs so
 * a test reads as "given a customer with 1000 available points" rather than
 * as a wall of unrelated setup.
 */

export interface CustomerFixture {
  user: User;
  wallet: Wallet;
}

export async function createCustomer(
  prisma: PrismaClient,
  overrides: Partial<{ phone: string; isActive: boolean; isPhoneVerified: boolean }> = {},
): Promise<CustomerFixture> {
  const user = await prisma.user.create({
    data: {
      phone: overrides.phone ?? `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
      // Not a real hash — nothing in these suites verifies a password.
      passwordHash: 'test-not-a-real-hash',
      firstName: 'Test',
      lastName: 'Customer',
      isActive: overrides.isActive ?? true,
      // Verified by default: most suites are about money movement, and an
      // unverified account cannot earn. Suites testing the gate itself pass
      // false explicitly.
      isPhoneVerified: overrides.isPhoneVerified ?? true,
      wallet: { create: {} },
    },
    include: { wallet: true },
  });

  return { user, wallet: user.wallet! };
}

/**
 * A minimal admin/staff user row — nothing more than what `AuditLog.actor`'s
 * foreign key requires. Tests that exercise a service method directly
 * (bypassing the controller, and so its `CurrentUser`-sourced actor id) still
 * need a real `User` row when that service writes its own audit record —
 * `PartnerCollectionService.confirm` is the first one to do this from inside
 * a transaction rather than leaving it to the controller.
 */
export async function createStaffUser(
  prisma: PrismaClient,
  overrides: Partial<{ firstName: string; lastName: string }> = {},
): Promise<User> {
  return prisma.user.create({
    data: {
      phone: `+3747${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
      passwordHash: 'test-not-a-real-hash',
      firstName: overrides.firstName ?? 'Staff',
      lastName: overrides.lastName ?? 'Admin',
      isActive: true,
      isPhoneVerified: true,
    },
  });
}

export async function createPartner(
  prisma: PrismaClient,
  overrides: Partial<{
    bonusAccrualRateBps: number;
    displayName: string;
    maxBonusPaymentPercent: number;
    evWholesaleRatePerKwh: string;
    evMarginReferralCapPerKwh: string;
  }> = {},
): Promise<Partner> {
  return prisma.partner.create({
    data: {
      legalName: 'Test Partner LLC',
      displayName: overrides.displayName ?? 'Test Partner',
      taxId: randomUUID(),
      category: 'retail',
      bonusAccrualRateBps: overrides.bonusAccrualRateBps ?? 500, // 5%
      ...(overrides.maxBonusPaymentPercent !== undefined
        ? { maxBonusPaymentPercent: overrides.maxBonusPaymentPercent }
        : {}),
      ...(overrides.evWholesaleRatePerKwh !== undefined
        ? { evWholesaleRatePerKwh: overrides.evWholesaleRatePerKwh }
        : {}),
      ...(overrides.evMarginReferralCapPerKwh !== undefined
        ? { evMarginReferralCapPerKwh: overrides.evMarginReferralCapPerKwh }
        : {}),
    },
  });
}

export async function createDynamicInvoiceQr(
  prisma: PrismaClient,
  params: { partnerId: string; amount: string; expiresInSeconds?: number },
) {
  return prisma.qrCode.create({
    data: {
      type: QrCodeType.DYNAMIC_INVOICE,
      token: randomUUID().replace(/-/g, ''),
      partnerId: params.partnerId,
      amount: params.amount,
      expiresAt: new Date(Date.now() + (params.expiresInSeconds ?? 900) * 1000),
    },
  });
}

export async function createEvConnector(
  prisma: PrismaClient,
  params: { partnerId: string; pricePerKwh?: string },
) {
  const station = await prisma.evStation.create({
    data: {
      partnerId: params.partnerId,
      name: 'Test Station',
      address: '1 Test St',
      city: 'Yerevan',
      latitude: 40.1772,
      longitude: 44.5035,
    },
  });

  return prisma.evConnector.create({
    data: {
      stationId: station.id,
      connectorType: EvConnectorType.CCS2,
      powerKw: '50.00',
      pricePerKwh: params.pricePerKwh ?? '100.00',
    },
  });
}

/**
 * A ROAMING_CPO-provider station + connector, external ids and all — the
 * fixture `roaming-cpo-settlement.int-spec.ts` builds on. `externalStationId`/
 * `externalConnectorId` default to fresh random ids so parallel tests never
 * collide on the unique index.
 */
export async function createRoamingCpoStation(
  prisma: PrismaClient,
  params: {
    partnerId: string;
    standardRetailRatePerKwh?: string;
    externalStationId?: string;
    externalConnectorId?: string;
  },
) {
  const station = await prisma.evStation.create({
    data: {
      partnerId: params.partnerId,
      provider: 'ROAMING_CPO',
      externalStationId: params.externalStationId ?? `roaming-station-${randomUUID()}`,
      name: 'Roaming-CPO Test Station',
      address: '2 Test Ave',
      city: 'Yerevan',
      latitude: 40.18,
      longitude: 44.51,
      standardRetailRatePerKwh: params.standardRetailRatePerKwh ?? '115.00',
    },
  });

  const connector = await prisma.evConnector.create({
    data: {
      stationId: station.id,
      externalConnectorId: params.externalConnectorId ?? `roaming-connector-${randomUUID()}`,
      connectorType: EvConnectorType.CCS2,
      powerKw: '60.00',
      // Never read for a ROAMING_CPO session — every session carries its own
      // appliedCustomerRatePerKwh — but the column is non-null on the schema.
      pricePerKwh: params.standardRetailRatePerKwh ?? '115.00',
    },
  });

  return { station, connector };
}

export async function linkRoamingCpoCustomer(
  prisma: PrismaClient,
  params: { partnerId: string; userId: string; externalCustomerId?: string },
) {
  return prisma.roamingCustomerLink.create({
    data: {
      partnerId: params.partnerId,
      userId: params.userId,
      externalCustomerId: params.externalCustomerId ?? `roaming-cust-${randomUUID()}`,
    },
  });
}
