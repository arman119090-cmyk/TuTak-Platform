import { PrismaClient, RoleName } from '@prisma/client';
import type { Request } from 'express';
import { UsersController } from '../src/modules/users/users.controller';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Nearby-partner personalisation's consent switch (2026-08-26) — spec:
 * "как ты думаешь это правильно или нет" (Arman), answered by making this an
 * explicit, off-by-default opt-in, same posture as the avatar-consent flag
 * `media-system.int-spec.ts` already covers. What is checked here is that
 * posture: defaults withheld, a customer can turn it on and off for
 * themselves, and every change is audited.
 */
describe('Personalization consent (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let controller: UsersController;

  const req = { ip: '127.0.0.1', get: () => 'jest' } as unknown as Request;

  const asUser = (id: string): RequestUser => ({
    id,
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
  });

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    controller = harness.app.get(UsersController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('defaults to withheld', async () => {
    const { user } = await createCustomer(prisma);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.personalizedRecommendationsConsent).toBe(false);

    const me = await controller.me(asUser(user.id));
    expect(me!.personalizedRecommendationsEnabled).toBe(false);
  });

  it('lets a customer turn it on, then back off, for themselves', async () => {
    const { user } = await createCustomer(prisma);

    const on = await controller.updatePersonalizationConsent(
      asUser(user.id),
      { personalizedRecommendationsEnabled: true },
      req,
    );
    expect(on.personalizedRecommendationsEnabled).toBe(true);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).personalizedRecommendationsConsent,
    ).toBe(true);

    const off = await controller.updatePersonalizationConsent(
      asUser(user.id),
      { personalizedRecommendationsEnabled: false },
      req,
    );
    expect(off.personalizedRecommendationsEnabled).toBe(false);
  });

  it('audits every change, actor and outcome', async () => {
    const { user } = await createCustomer(prisma);

    await controller.updatePersonalizationConsent(asUser(user.id), { personalizedRecommendationsEnabled: true }, req);
    await controller.updatePersonalizationConsent(asUser(user.id), { personalizedRecommendationsEnabled: false }, req);

    const logs = await prisma.auditLog.findMany({
      where: { action: 'PERSONALIZATION_CONSENT_CHANGED', entityId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.actorUserId).toBe(user.id);
    expect(logs[0]!.metadata).toMatchObject({ personalizedRecommendationsEnabled: true });
    expect(logs[1]!.metadata).toMatchObject({ personalizedRecommendationsEnabled: false });
  });
});
