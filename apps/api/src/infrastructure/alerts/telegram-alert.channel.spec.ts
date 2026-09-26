import { Logger } from '@nestjs/common';
import { TelegramAlertChannel } from './telegram-alert.channel';

/**
 * Same contract as the webhook channel: delivered is the receiver's word.
 *
 * Plus one thing the webhook does not have to worry about — the bot token
 * lives in the request URL, so a failure path that echoed the URL into a
 * log or a returned detail would leak the credential into Railway's log
 * store and into `alert:verify`'s console output.
 */
describe('TelegramAlertChannel', () => {
  const token = '123456:AAAA-secret-token';
  const alert = {
    severity: 'critical' as const,
    title: 'A payment callback gave up',
    body: 'test',
    key: 'psp.callback-dead-letter:test_bill_1',
    context: { billId: 'bill_1' },
  };

  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  const answering = (status: number, body: unknown) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('reports delivered only when Telegram answered 2xx with ok: true', async () => {
    const fetchMock = answering(200, { ok: true, result: { message_id: 1 } });
    const result = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);

    expect(result).toEqual({ delivered: true, detail: 'telegram answered 200' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body)) as { chat_id: string; text: string; parse_mode?: string };
    expect(payload.chat_id).toBe('-100777');
    // Plain text: an alert key with underscores must not be rejected as bad Markdown.
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.text).toContain('A payment callback gave up — production');
    expect(payload.text).toContain('billId: bill_1');
    expect(payload.text).toContain('key: psp.callback-dead-letter:test_bill_1');
  });

  it('reports not delivered when Telegram says ok: false, even on HTTP 200', async () => {
    answering(200, { ok: false, description: 'Bad Request: chat not found' });
    const result = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);

    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/chat not found/);
  });

  it('reports not delivered on a 4xx, naming the status', async () => {
    answering(401, { ok: false, description: 'Unauthorized' });
    const result = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);

    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/401/);
  });

  it('reports not delivered, and does not throw, when Telegram is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const result = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);

    expect(result).toEqual({ delivered: false, detail: 'telegram unreachable: fetch failed' });
  });

  it('never writes the bot token into a log line or a returned detail', async () => {
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    answering(401, { ok: false, description: 'Unauthorized' });
    const rejected = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const unreachable = await new TelegramAlertChannel(token, '-100777', 'production').send(alert);

    for (const text of [rejected.detail, unreachable.detail, ...logged]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain('secret-token');
    }
    expect(logged.length).toBeGreaterThanOrEqual(2);
  });
});
