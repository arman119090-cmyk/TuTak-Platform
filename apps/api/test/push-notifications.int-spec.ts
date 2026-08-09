import { EventEmitter2 } from '@nestjs/event-emitter';
import { DevicePlatform, PrismaClient } from '@prisma/client';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PushDispatchService } from '../src/modules/notifications/push-dispatch.service';
import {
  PUSH_PROVIDER,
  PushDeliveryResult,
  PushMessage,
  PushProvider,
} from '../src/infrastructure/push/push-provider.interface';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, settleEvents, truncateAll } from './setup/harness';

/**
 * Push delivery.
 *
 * The behaviour worth pinning down is not "a message was sent" — that is one
 * HTTP call — but everything around it: which devices are chosen, what
 * happens when the same phone appears twice, whether a dead token is
 * forgotten, and above all whether a broken push service can reach back and
 * break the thing that triggered the notification.
 */
describe('Push notifications (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let notifications: NotificationsService;
  let dispatch: PushDispatchService;
  let provider: PushProvider;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
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

  /** Captures what reached the provider without touching the network. */
  const capture = (result?: Partial<PushDeliveryResult>) => {
    const sent: PushMessage[][] = [];
    jest.spyOn(provider, 'send').mockImplementation((messages) => {
      sent.push(messages);
      return Promise.resolve({
        invalidTokens: result?.invalidTokens ?? [],
        delivered: result?.delivered ?? messages.length,
      });
    });
    return sent;
  };

  const addDevice = (userId: string, deviceId: string, pushToken: string | null) =>
    prisma.device.create({
      data: { userId, deviceId, platform: DevicePlatform.ANDROID, pushToken },
    });

  // ── Registration ──────────────────────────────────────────────────────

  it('records a token against the caller and updates it on re-registration', async () => {
    const { user } = await createCustomer(prisma);

    await notifications.registerPushToken({
      userId: user.id,
      deviceId: 'phone-1',
      platform: DevicePlatform.IOS,
      pushToken: 'ExponentPushToken[first]',
    });
    await notifications.registerPushToken({
      userId: user.id,
      deviceId: 'phone-1',
      platform: DevicePlatform.IOS,
      pushToken: 'ExponentPushToken[second]',
    });

    const devices = await prisma.device.findMany({ where: { userId: user.id } });
    // Reinstalling the app rotates the token. A second row would mean every
    // notification went out twice, once to a token that no longer works.
    expect(devices).toHaveLength(1);
    expect(devices[0]!.pushToken).toBe('ExponentPushToken[second]');
  });

  it('keeps two different phones separate', async () => {
    const { user } = await createCustomer(prisma);
    await notifications.registerPushToken({
      userId: user.id,
      deviceId: 'phone',
      platform: DevicePlatform.IOS,
      pushToken: 'ExponentPushToken[phone]',
    });
    await notifications.registerPushToken({
      userId: user.id,
      deviceId: 'tablet',
      platform: DevicePlatform.ANDROID,
      pushToken: 'ExponentPushToken[tablet]',
    });

    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(2);
  });

  // ── Delivery ──────────────────────────────────────────────────────────

  it('sends to every device the user has registered', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'a', 'ExponentPushToken[a]');
    await addDevice(user.id, 'b', 'ExponentPushToken[b]');
    const sent = capture();

    await dispatch.dispatch({ userId: user.id, title: 'Paid', body: '5000 AMD' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[a]',
      'ExponentPushToken[b]',
    ]);
  });

  it('sends once when two device rows share a token', async () => {
    // A phone reinstalled under a fresh device id keeps its push token.
    // Sending per row would show the customer the same notification twice.
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'old-install', 'ExponentPushToken[same]');
    await addDevice(user.id, 'new-install', 'ExponentPushToken[same]');
    const sent = capture();

    await dispatch.dispatch({ userId: user.id, title: 'Paid', body: '5000 AMD' });

    expect(sent[0]).toHaveLength(1);
  });

  it('never sends to another user', async () => {
    const { user: mine } = await createCustomer(prisma);
    const { user: theirs } = await createCustomer(prisma);
    await addDevice(mine.id, 'mine', 'ExponentPushToken[mine]');
    await addDevice(theirs.id, 'theirs', 'ExponentPushToken[theirs]');
    const sent = capture();

    await dispatch.dispatch({ userId: mine.id, title: 'Paid', body: '5000 AMD' });

    expect(sent[0]!.map((m) => m.to)).toEqual(['ExponentPushToken[mine]']);
  });

  it('does not call the provider at all when nothing is registered', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'web-session', null);
    const sent = capture();

    await dispatch.dispatch({ userId: user.id, title: 'Paid', body: '5000 AMD' });

    expect(sent).toHaveLength(0);
  });

  it('forgets a token the service reports as dead', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'live', 'ExponentPushToken[live]');
    await addDevice(user.id, 'dead', 'ExponentPushToken[dead]');
    capture({ invalidTokens: ['ExponentPushToken[dead]'] });

    await dispatch.dispatch({ userId: user.id, title: 'Paid', body: '5000 AMD' });

    const devices = await prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { deviceId: 'asc' },
    });
    // The device row survives — it is also the session record — but the
    // token is cleared so it stops occupying a slot in every future batch.
    expect(devices.map((d) => [d.deviceId, d.pushToken])).toEqual([
      ['dead', null],
      ['live', 'ExponentPushToken[live]'],
    ]);
  });

  // ── The property that makes this safe to switch on ────────────────────

  it('persists the notification even when the push provider throws', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'a', 'ExponentPushToken[a]');
    jest.spyOn(provider, 'send').mockRejectedValue(new Error('push service down'));

    await expect(
      notifications.send({
        userId: user.id,
        titleKey: 'notifications.transactionCompletedTitle',
        bodyKey: 'notifications.transactionCompletedBody',
        push: { title: 'Paid', body: '5000 AMD' },
      }),
    ).resolves.toBeDefined();

    // The inbox row is the record. It must exist whether or not a phone was
    // reachable — otherwise a push outage silently erases history.
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it('writes the row and sends nothing when no push text was given', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'a', 'ExponentPushToken[a]');
    const sent = capture();

    await notifications.send({
      userId: user.id,
      titleKey: 'notifications.welcomeTitle',
      bodyKey: 'notifications.welcomeBody',
    });

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('carries the notification id so the app can open the right screen', async () => {
    const { user } = await createCustomer(prisma);
    await addDevice(user.id, 'a', 'ExponentPushToken[a]');
    const sent = capture();

    const notification = await notifications.send({
      userId: user.id,
      titleKey: 'notifications.transactionCompletedTitle',
      bodyKey: 'notifications.transactionCompletedBody',
      push: { title: 'Paid', body: '5000 AMD' },
    });

    expect(sent[0]![0]!.data).toEqual({ notificationId: notification.id });
  });
});

/**
 * The event path, which nothing covered.
 *
 * Every test above calls `NotificationsService.send` directly. Nothing
 * asserted that a domain event actually reaches the listener that calls it —
 * so replacing the emitter in the harness (see `SettleableEventEmitter`)
 * could have silenced notifications entirely and the suite would still have
 * been green. That is the failure mode this file exists to make impossible.
 */
describe('Notifications reach the listener that writes them (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let events: EventEmitter2;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    events = harness.app.get(EventEmitter2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('writes a welcome notification when a registration is announced', async () => {
    const { user } = await createCustomer(prisma);

    events.emit('auth.user.registered', { userId: user.id });

    // No sleep and no polling: `truncateAll` waits for the same work, so if
    // this needed a timer the next test would be racing it.
    await settleEvents();

    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.titleKey).toBe('notifications.welcomeTitle');
  });

  it('does not truncate out from under a listener that is still writing', async () => {
    // The property, stated as an ordering rather than a duration.
    //
    // The race this prevents does not reproduce on demand: on this machine
    // the listener always happened to finish first, and the failure appeared
    // only on a loaded CI runner, as a deadlock between the TRUNCATE and the
    // INSERT it collided with. An earlier version of this test asserted "no
    // rows leaked", which passed with or without the fix. A second version
    // gave the listener a 150ms delay and *also* passed without the fix,
    // because truncating thirty-eight tables takes about that long. Both were
    // worthless, and both looked fine.
    //
    // So the listener blocks until this test releases it, and the assertion
    // is that truncation has not finished while it is still blocked. There is
    // no duration to lose a race against.
    const notifications = harness.app.get(NotificationsService);
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(notifications, 'send').mockImplementation(async () => {
      await blocked;
      return {} as never;
    });

    const { user } = await createCustomer(prisma);
    events.emit('auth.user.registered', { userId: user.id });

    let truncated = false;
    const truncating = truncateAll(prisma).then(() => {
      truncated = true;
    });

    // A second is far longer than truncation needs, so if it were going to
    // run ahead of the listener it would have done so by now.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      expect(truncated).toBe(false);
    } finally {
      // Released whatever the assertion decided. Without this, a regression
      // leaves the listener blocked forever and the suite hangs instead of
      // failing — which is how a broken guarantee turns into a CI timeout
      // that says nothing about what broke.
      release();
      await truncating;
    }

    expect(truncated).toBe(true);
  });
});
