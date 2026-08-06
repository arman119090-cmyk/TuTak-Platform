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

export async function createPartner(
  prisma: PrismaClient,
  overrides: Partial<{ bonusAccrualRateBps: number; displayName: string }> = {},
): Promise<Partner> {
  return prisma.partner.create({
    data: {
      legalName: 'Test Partner LLC',
      displayName: overrides.displayName ?? 'Test Partner',
      taxId: randomUUID(),
      category: 'retail',
      bonusAccrualRateBps: overrides.bonusAccrualRateBps ?? 500, // 5%
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
