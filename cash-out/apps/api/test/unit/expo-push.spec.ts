import { AppLogger } from '../../src/common/logging/logger.service';
import {
  ExpoPushAdapter,
  FetchLike,
  PUSH_TOKEN_DEAD,
} from '../../src/modules/notifications/expo-push.adapter';
import { notificationText } from '../../src/modules/notifications/notification-texts';
import { IntegrationHealthRecorder } from '../../src/modules/integration-health/integration-health.recorder';
import { testEnv } from '../harness';

const logger = new AppLogger(testEnv());

class RecorderSpy extends IntegrationHealthRecorder {
  readonly calls: Array<{ ok: boolean; error?: string }> = [];
  constructor() {
    super(null as never, null as never);
  }
  override async record(_integration: string, ok: boolean, error?: string): Promise<void> {
    this.calls.push({ ok, error });
  }
}

function fetchReturning(status: number, body: unknown, capture?: { request?: unknown }): FetchLike {
  return async (_input, init) => {
    if (capture) capture.request = JSON.parse(init.body);
    return { status, text: async () => JSON.stringify(body) };
  };
}

const notification = {
  driverId: 'd1',
  kind: 'PAYOUT_COMPLETED' as const,
  locale: 'ru',
  pushToken: 'ExponentPushToken[abc]',
  payload: { amount: '10 000 AMD' },
};

describe('ExpoPushAdapter (LIVE-UNVERIFIED against a real device)', () => {
  it('sends the localised title and body, with the kind in data, and reports the ticket id', async () => {
    const health = new RecorderSpy();
    const capture: {
      request?: { to: string; title: string; body: string; data: Record<string, unknown> };
    } = {};
    const adapter = new ExpoPushAdapter(
      { accessToken: 'tok', timeoutMs: 100 },
      logger,
      health,
      fetchReturning(200, { data: [{ status: 'ok', id: 'ticket-1' }] }, capture),
    );
    await expect(adapter.send(notification)).resolves.toEqual({
      delivered: true,
      providerMessageId: 'ticket-1',
    });
    expect(capture.request).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'Деньги отправлены',
      body: '10 000 AMD отправлено на ваш iDram',
      data: { kind: 'PAYOUT_COMPLETED', amount: '10 000 AMD' },
    });
    expect(health.calls).toEqual([{ ok: true, error: undefined }]);
  });

  it('a dead device token is final: the sweeper drops it instead of retrying', async () => {
    const adapter = new ExpoPushAdapter(
      { timeoutMs: 100 },
      logger,
      new RecorderSpy(),
      fetchReturning(200, {
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    );
    await expect(adapter.send(notification)).resolves.toEqual({
      delivered: false,
      reason: PUSH_TOKEN_DEAD,
    });
  });

  it('a token that is not an Expo token is dead without a network call', async () => {
    let called = false;
    const adapter = new ExpoPushAdapter({ timeoutMs: 100 }, logger, new RecorderSpy(), async () => {
      called = true;
      return { status: 200, text: async () => '{}' };
    });
    await expect(adapter.send({ ...notification, pushToken: 'fcm-raw-token' })).resolves.toEqual({
      delivered: false,
      reason: PUSH_TOKEN_DEAD,
    });
    expect(called).toBe(false);
  });

  it('no token: not delivered, no call', async () => {
    const adapter = new ExpoPushAdapter(
      { timeoutMs: 100 },
      logger,
      new RecorderSpy(),
      fetchReturning(200, {}),
    );
    await expect(adapter.send({ ...notification, pushToken: null })).resolves.toEqual({
      delivered: false,
      reason: 'no_push_token',
    });
  });

  it('a 5xx or a network error is retryable and recorded as unhealthy', async () => {
    const health = new RecorderSpy();
    const down = new ExpoPushAdapter({ timeoutMs: 100 }, logger, health, fetchReturning(503, {}));
    await expect(down.send(notification)).resolves.toEqual({
      delivered: false,
      reason: 'http_503',
    });
    const broken = new ExpoPushAdapter({ timeoutMs: 100 }, logger, health, async () => {
      throw new Error('ECONNRESET');
    });
    await expect(broken.send(notification)).resolves.toEqual({
      delivered: false,
      reason: 'network_error',
    });
    expect(health.calls.map((c) => c.ok)).toEqual([false, false]);
  });

  it('a hung request times out', async () => {
    const adapter = new ExpoPushAdapter(
      { timeoutMs: 30 },
      logger,
      new RecorderSpy(),
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    await expect(adapter.send(notification)).resolves.toEqual({
      delivered: false,
      reason: 'timeout',
    });
  });

  it('has a text for every kind in every language, with placeholders filled', () => {
    for (const kind of [
      'PAYOUT_COMPLETED',
      'PAYOUT_CANCELLED',
      'PAYOUT_REJECTED',
      'PAYOUT_UNDER_REVIEW',
      'AUTO_PAYOUT_CREATED',
      'AUTO_PAYOUT_PAUSED',
      'SECURITY_PIN_CHANGED',
      'SECURITY_BIOMETRIC_CHANGED',
      'SECURITY_NEW_DEVICE',
      'PARK_SWITCHED',
      'PARK_ACCESS_CHANGED',
      'DRIVER_ID_DECIDED',
    ] as const) {
      for (const locale of ['hy', 'ru', 'en']) {
        const text = notificationText(kind, locale, { amount: '1 AMD', park: 'Park' });
        expect(text.title.length).toBeGreaterThan(0);
        expect(text.body).not.toMatch(/\{\{/);
      }
    }
    expect(notificationText('PARK_SWITCHED', 'xx', { park: 'Sun' }).body).toContain('Sun');
  });
});
