import { AlertsService } from '../infrastructure/alerts/alerts.service';
import { AlertChannel } from '../infrastructure/alerts/alert-channel.interface';
import { buildVerificationAlert, runAlertVerify } from './alert-verify';

/**
 * What `alert:verify` must not do is report success when nobody was told.
 *
 * That is the only way this script can be actively harmful: an operator runs
 * it, sees "sent", ticks the box, and the first real reconciliation
 * discrepancy goes to a console log in a container nobody is attached to.
 * Both cases below are that failure wearing different clothes — a webhook
 * that was never configured, and a suppression layer that quietly ate the
 * message.
 */
describe('alert:verify', () => {
  const webhook = { name: 'webhook', send: jest.fn() } as unknown as AlertChannel;
  const console_ = { name: 'console', send: jest.fn() } as unknown as AlertChannel;

  const alertsThatReport = (sent: boolean) =>
    ({ fire: jest.fn().mockResolvedValue(sent) }) as unknown as AlertsService;

  it('reports success only when a real channel accepted it', async () => {
    const result = await runAlertVerify(alertsThatReport(true), webhook);

    expect(result).toMatchObject({ sent: true, channel: 'webhook' });
  });

  it('refuses to call the console a delivered alert', async () => {
    // The whole point of P0-4: `AlertsModule` falls back to the console when
    // `ALERT_WEBHOOK_URL` is unset, and the fallback is deliberately quiet
    // enough to boot with. A verification tool that counted it as success
    // would certify precisely the state it exists to detect.
    const result = await runAlertVerify(alertsThatReport(true), console_);

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/ALERT_WEBHOOK_URL is not set/);
  });

  it('says to check Redis when the alert was suppressed', async () => {
    // The key is timestamped, so suppression cannot legitimately claim it.
    // If it did, the suppression store — not the webhook — is what is broken,
    // and that is a different thing to go and fix.
    const result = await runAlertVerify(alertsThatReport(false), webhook);

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/REDIS_URL/);
  });

  it('gives every run its own key, so a second run is not swallowed', () => {
    const first = buildVerificationAlert(new Date('2026-09-13T10:00:00.000Z'));
    const second = buildVerificationAlert(new Date('2026-09-13T10:00:01.000Z'));

    expect(first.key).not.toBe(second.key);
  });

  it('says in the message itself that it is a test', () => {
    // Read at three in the morning by somebody who was woken by it. They
    // should know inside one sentence that nothing is wrong.
    const alert = buildVerificationAlert(new Date());

    expect(alert.title).toMatch(/test/i);
    expect(alert.body).toMatch(/Nothing is wrong/);
    expect(alert.context.kind).toBe('alert-verify');
    // Not `critical`: a test that pages the on-call rotation is a test
    // people stop running.
    expect(alert.severity).toBe('warning');
  });
});
