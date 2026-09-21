import { AlertsService } from './alerts.service';
import { Alert, AlertChannel, AlertDelivery } from './alert-channel.interface';

/**
 * Audit of 21.09.2026, D05: a send that failed must not count as delivered
 * for the purposes of suppression. The auditor's counter-example — first
 * fire fails at the transport, second fire is suppressed, the channel was
 * called once — is the first test; the rest pin the bounded backoff and
 * that a genuine delivery still suppresses repeats for the full window.
 *
 * Redis is a fake with the four commands the service uses; the channel is
 * scripted per call.
 */
type Entry = { value: string; expiresAt: number };

class FakeRedis {
  private readonly store = new Map<string, Entry>();
  now = 1_000_000;

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: string, _ex: 'EX', seconds: number, mode: 'NX' | 'XX'): Promise<'OK' | null> {
    const exists = this.live(key) !== undefined;
    if (mode === 'NX' && exists) return Promise.resolve(null);
    if (mode === 'XX' && !exists) return Promise.resolve(null);
    this.store.set(key, { value, expiresAt: this.now + seconds * 1000 });
    return Promise.resolve('OK');
  }
  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }
  incr(key: string): Promise<number> {
    const next = Number(this.live(key)?.value ?? '0') + 1;
    this.store.set(key, { value: String(next), expiresAt: this.live(key)?.expiresAt ?? Number.MAX_SAFE_INTEGER });
    return Promise.resolve(next);
  }
  expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(0);
    entry.expiresAt = this.now + seconds * 1000;
    return Promise.resolve(1);
  }
  ttl(key: string): number {
    const entry = this.live(key);
    return entry ? Math.round((entry.expiresAt - this.now) / 1000) : -2;
  }
  advance(seconds: number) {
    this.now += seconds * 1000;
  }
}

class ScriptedChannel implements AlertChannel {
  readonly name = 'scripted';
  sends = 0;
  constructor(private readonly script: AlertDelivery[]) {}
  send(): Promise<AlertDelivery> {
    this.sends += 1;
    return Promise.resolve(this.script[Math.min(this.sends - 1, this.script.length - 1)]!);
  }
}

const alert: Alert = { severity: 'critical', title: 'x', body: 'y', key: 'fixture' };
const failed: AlertDelivery = { delivered: false, detail: 'network failure', retryable: true };
const ok: AlertDelivery = { delivered: true, detail: 'webhook answered 200' };

function build(script: AlertDelivery[]) {
  const redis = new FakeRedis();
  const channel = new ScriptedChannel(script);
  const service = new AlertsService(channel, redis as never);
  return { redis, channel, service };
}

describe('AlertsService — failed delivery does not consume the window (audit D05)', () => {
  it("the auditor's case: after a failed send the next fire is retried, not suppressed", async () => {
    const { redis, channel, service } = build([failed, ok]);
    const first = await service.fire(alert);
    expect(first).toMatchObject({ suppressed: false, delivered: false });
    // A failed send holds the key for the short retry window only.
    expect(redis.ttl('alert:sent:fixture')).toBe(60);

    // Inside the retry window: still quiet (no storm)…
    redis.advance(30);
    expect(await service.fire(alert)).toMatchObject({ suppressed: true });
    expect(channel.sends).toBe(1);

    // …and once it passes, the alert is sent again and lands.
    redis.advance(31);
    const second = await service.fire(alert);
    expect(second).toMatchObject({ suppressed: false, delivered: true });
    expect(channel.sends).toBe(2);
    // A delivered alert keeps the full window.
    expect(redis.ttl('alert:sent:fixture')).toBe(15 * 60);
  });

  it('backs off on consecutive failures — 60, 120, 240, 480, then the full window — and never releases the key', async () => {
    const { redis, channel, service } = build([failed]);
    const windows: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const outcome = await service.fire(alert);
      expect(outcome.suppressed).toBe(false);
      windows.push(redis.ttl('alert:sent:fixture'));
      redis.advance(windows[i]! + 1);
    }
    expect(windows).toEqual([60, 120, 240, 480, 900, 900]);
    expect(channel.sends).toBe(6);
  });

  it('a delivery resets the failure streak', async () => {
    const { redis, channel, service } = build([failed, failed, ok, failed]);
    await service.fire(alert);
    redis.advance(61);
    await service.fire(alert);
    expect(redis.ttl('alert:sent:fixture')).toBe(120);
    redis.advance(121);
    await service.fire(alert); // delivered
    redis.advance(15 * 60 + 1);
    await service.fire(alert); // fails again: back to the first step
    expect(redis.ttl('alert:sent:fixture')).toBe(60);
    expect(channel.sends).toBe(4);
  });

  it('a channel that cannot deliver by design (console) keeps the full window: no retry storm in development', async () => {
    const { redis, channel, service } = build([{ delivered: false, detail: 'logged to the console; no human was told' }]);
    await service.fire(alert);
    expect(redis.ttl('alert:sent:fixture')).toBe(15 * 60);
    redis.advance(61);
    expect(await service.fire(alert)).toMatchObject({ suppressed: true });
    expect(channel.sends).toBe(1);
  });

  it('a delivered alert suppresses repeats for the full window, as before', async () => {
    const { redis, channel, service } = build([ok]);
    expect(await service.fire(alert)).toMatchObject({ suppressed: false, delivered: true });
    redis.advance(14 * 60);
    expect(await service.fire(alert)).toMatchObject({ suppressed: true });
    redis.advance(61);
    expect(await service.fire(alert)).toMatchObject({ suppressed: false, delivered: true });
    expect(channel.sends).toBe(2);
  });
});
