import { DevicePlatform, PrismaClient } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PushDispatchService } from '../src/modules/notifications/push-dispatch.service';
import {
  PUSH_PROVIDER,
  PushMessage,
  PushProvider,
} from '../src/infrastructure/push/push-provider.interface';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What a sign-out has to take with it.
 *
 * Revoking the refresh tokens closes the session's ability to *ask* for
 * things. It says nothing about the push token, which is the opposite
 * direction — an address the platform uses to reach the handset unprompted.
 * Left behind, it keeps delivering one account's notifications to a phone
 * whose owner signed out of that account, and the bodies carry payment
 * amounts, so this is somebody's money on somebody else's lock screen.
 *
 * The account-switch case is worse than staleness: `registerPushToken`
 * upserts on `(userId, deviceId)`, so the next person to sign in on the same
 * handset adds a second Device row carrying the same token, and the phone
 * becomes a live delivery address for two accounts at once.
 */
describe('Push registration ends with the session (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let notifications: NotificationsService;
  let dispatch: PushDispatchService;
  let provider: PushProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    notifications = harness.app.get(NotificationsService);
    dispatch = harness.app.get(PushDispatchService);
    provider = harness.app.get(PUSH_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
  });

  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  /** Captures what reached the provider without touching the network. */
  const capture = () => {
    const sent: PushMessage[][] = [];
    jest.spyOn(provider, 'send').mockImplementation((messages) => {
      sent.push(messages);
      return Promise.resolve({ invalidTokens: [], delivered: messages.length });
    });
    return sent;
  };

  const register = (userId: string, deviceId: string, pushToken: string) =>
    notifications.registerPushToken({
      userId,
      deviceId,
      platform: DevicePlatform.ANDROID,
      pushToken,
    });

  const notify = (userId: string) =>
    dispatch.dispatch({
      userId,
      title: 'Payment complete',
      body: '4 200 AMD paid.',
      data: {},
    });

  const tokensSent = (batches: PushMessage[][]) =>
    batches.flat().map((message) => message.to);

  it('drops the push token of the device that signed out', async () => {
    const { user } = await createCustomer(prisma);
    await register(user.id, 'device-1', 'ExponentPushToken[aaa]');

    await auth.logout(user.id, 'device-1', meta);

    const sent = capture();
    await notify(user.id);

    expect(tokensSent(sent)).toEqual([]);
    const device = await prisma.device.findFirst({ where: { userId: user.id } });
    // The row stays — deviceName and lastSeenAt are history worth keeping.
    // What must be gone is the ability to deliver.
    expect(device).not.toBeNull();
    expect(device!.pushToken).toBeNull();
  });

  it('does not deliver to a handset the next person has signed in on', async () => {
    const { user: userA } = await createCustomer(prisma);
    const { user: userB } = await createCustomer(prisma);
    const handset = 'ExponentPushToken[shared-handset]';

    await register(userA.id, 'device-1', handset);
    await auth.logout(userA.id, 'device-1', meta);
    // Same phone, same device id, next person: an upsert on (userId,
    // deviceId) makes this a second row, not a replacement.
    await register(userB.id, 'device-1', handset);

    const sent = capture();
    await notify(userA.id);

    expect(tokensSent(sent)).toEqual([]);
  });

  it('leaves the new occupant’s own notifications working', async () => {
    const { user: userA } = await createCustomer(prisma);
    const { user: userB } = await createCustomer(prisma);
    const handset = 'ExponentPushToken[shared-handset]';

    await register(userA.id, 'device-1', handset);
    await auth.logout(userA.id, 'device-1', meta);
    await register(userB.id, 'device-1', handset);

    const sent = capture();
    await notify(userB.id);

    expect(tokensSent(sent)).toEqual([handset]);
  });

  it('signs out one device without silencing the user’s other devices', async () => {
    const { user } = await createCustomer(prisma);
    await register(user.id, 'phone', 'ExponentPushToken[phone]');
    await register(user.id, 'tablet', 'ExponentPushToken[tablet]');

    await auth.logout(user.id, 'phone', meta);

    const sent = capture();
    await notify(user.id);

    // Signing out of one device is not a decision about the others.
    expect(tokensSent(sent)).toEqual(['ExponentPushToken[tablet]']);
  });

  it('registers again on the next sign-in from the same device', async () => {
    const { user } = await createCustomer(prisma);
    await register(user.id, 'device-1', 'ExponentPushToken[first]');
    await auth.logout(user.id, 'device-1', meta);

    // What the app does on the next sign-in: same device id, fresh token.
    await register(user.id, 'device-1', 'ExponentPushToken[second]');

    const sent = capture();
    await notify(user.id);

    expect(tokensSent(sent)).toEqual(['ExponentPushToken[second]']);
    // Still one row for this handset — re-registration updates, never
    // accumulates.
    const devices = await prisma.device.findMany({ where: { userId: user.id } });
    expect(devices).toHaveLength(1);
  });

  it('still revokes the refresh tokens it always did', async () => {
    const { user } = await createCustomer(prisma);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        deviceId: 'device-1',
        tokenHash: 'hash-under-test',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await auth.logout(user.id, 'device-1', meta);

    const live = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toEqual([]);
  });

  it('is harmless on a device that never registered for push', async () => {
    const { user } = await createCustomer(prisma);

    await expect(auth.logout(user.id, 'never-seen', meta)).resolves.toEqual({ success: true });
  });
});
