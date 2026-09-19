import { Logger } from '@nestjs/common';
import { CompositeAlertChannel } from './composite-alert.channel';
import { TelegramAlertChannel } from './telegram-alert.channel';

describe('TelegramAlertChannel', () => {
  const token = '123456:ABC-secret-token';
  const alert = {
    severity: 'critical' as const,
    title: 'A payment callback gave up',
    body: 'test',
    key: 'psp.callback-dead-letter:test',
    context: { billId: 'bill-1' },
  };

  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
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

  it('is delivered only when the Bot API answers 2xx with ok:true', async () => {
    const fetchMock = answering(200, { ok: true, result: { message_id: 1 } });
    const channel = new TelegramAlertChannel(token, '-100123', 'production');
    await expect(channel.send(alert)).resolves.toEqual({ delivered: true, detail: 'telegram answered 200' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    const payload = JSON.parse(init.body as string) as { chat_id: string; text: string };
    expect(payload.chat_id).toBe('-100123');
    expect(payload.text).toContain('A payment callback gave up');
    expect(payload.text).toContain('billId: bill-1');
  });

  it('is not delivered when Telegram answers 200 with ok:false (bot not in the chat)', async () => {
    answering(200, { ok: false, description: 'Bad Request: chat not found' });
    const channel = new TelegramAlertChannel(token, '-100123', 'production');
    const delivery = await channel.send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).toContain('chat not found');
  });

  it('is not delivered on a non-2xx answer and never leaks the token', async () => {
    answering(401, { ok: false, description: `Unauthorized for bot${token}` });
    const channel = new TelegramAlertChannel(token, '-100123', 'production');
    const delivery = await channel.send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).not.toContain(token);
    expect(delivery.detail).toContain('401');
  });

  it('scrubs the token out of a transport error message', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error(`connect ECONNREFUSED https://api.telegram.org/bot${token}/sendMessage`)) as unknown as typeof fetch;
    const channel = new TelegramAlertChannel(token, '-100123', 'production');
    const delivery = await channel.send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).not.toContain(token);
    expect(delivery.detail).toContain('***');
  });
});

describe('TelegramAlertChannel — adversarial', () => {
  const token = '777:ZZZ-secret';
  const alert = { severity: 'critical' as const, title: 'T', body: 'B', key: 'k' };
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (status: number, body: unknown, jsonThrows = false) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => (jsonThrows ? Promise.reject(new Error('Unexpected token < in JSON')) : Promise.resolve(body)),
    }) as unknown as typeof fetch;
  };

  it.each([
    [400, { ok: false, description: 'Bad Request: message text is empty' }],
    [401, { ok: false, description: 'Unauthorized' }],
    [403, { ok: false, description: 'Forbidden: bot was blocked by the user' }],
    [429, { ok: false, description: 'Too Many Requests: retry after 35', parameters: { retry_after: 35 } }],
  ])('HTTP %s is not delivered and the detail carries the status, never the token', async (status, body) => {
    respond(status, body);
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).toContain(String(status));
    expect(delivery.detail).not.toContain(token);
  });

  it('a 2xx whose body is not JSON is not delivered', async () => {
    respond(200, null, true);
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery).toEqual({ delivered: false, detail: 'telegram answered 200' });
  });

  it('a 2xx with ok:true but a wrong shape is still delivered only on ok:true', async () => {
    respond(200, { ok: 'yes' });
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery.delivered).toBe(false);
  });

  it('a timeout (AbortError) is not delivered and does not throw', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })) as unknown as typeof fetch;
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).toContain('telegram unreachable');
  });

  it('a DNS failure whose message quotes the request URL is scrubbed', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error(`getaddrinfo ENOTFOUND api.telegram.org (https://api.telegram.org/bot${token}/sendMessage)`)) as unknown as typeof fetch;
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery.detail).not.toContain(token);
    expect(delivery.detail).toContain('***');
  });

  it('the description Telegram returns is scrubbed too, even if it echoes the token', async () => {
    respond(200, { ok: false, description: `token ${token} is invalid` });
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(alert);
    expect(delivery.detail).not.toContain(token);
  });

  it('truncates a huge alert to Telegram\'s 4096 limit and sends special characters as plain text', async () => {
    let sent = '';
    global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      sent = (JSON.parse(init.body as string) as { text: string; parse_mode?: string }).text;
      expect((JSON.parse(init.body as string) as { parse_mode?: string }).parse_mode).toBeUndefined();
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }) as unknown as typeof fetch;
    const huge = { ...alert, body: '_*[]()~`>#+-=|{}.!<b>'.repeat(400) };
    const delivery = await new TelegramAlertChannel(token, '1', 'production').send(huge);
    expect(delivery.delivered).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(4000);
    expect(sent).toContain('_*[]()~`>#+-=|{}.!<b>');
  });

  it('never logs the token through Nest Logger', async () => {
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown) => {
      logged.push(String(msg));
    });
    try {
      global.fetch = jest.fn().mockRejectedValue(new Error(`boom https://api.telegram.org/bot${token}/x`)) as unknown as typeof fetch;
      await new TelegramAlertChannel(token, '1', 'production').send(alert);
      respond(401, { ok: false, description: `bad bot${token}` });
      await new TelegramAlertChannel(token, '1', 'production').send(alert);
      expect(logged.length).toBe(2);
      for (const line of logged) expect(line).not.toContain(token);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('CompositeAlertChannel', () => {
  const alert = { severity: 'warning' as const, title: 't', body: 'b', key: 'k' };
  const channel = (name: string, delivered: boolean, detail = name) => ({
    name,
    send: jest.fn().mockResolvedValue({ delivered, detail }),
  });

  it('is delivered when any receiver accepted, and names them all', async () => {
    const composite = new CompositeAlertChannel([channel('webhook', false, 'webhook answered 500'), channel('telegram', true, 'telegram answered 200')]);
    expect(composite.name).toBe('webhook+telegram');
    await expect(composite.send(alert)).resolves.toEqual({
      delivered: true,
      detail: 'webhook: webhook answered 500; telegram: telegram answered 200',
    });
  });

  it('is not delivered when every receiver refused, and a throwing receiver does not hide the others', async () => {
    const throwing = { name: 'webhook', send: jest.fn().mockRejectedValue(new Error('boom')) };
    const composite = new CompositeAlertChannel([throwing, channel('telegram', false, 'telegram answered 403')]);
    const delivery = await composite.send(alert);
    expect(delivery.delivered).toBe(false);
    expect(delivery.detail).toBe('webhook: channel threw: boom; telegram: telegram answered 403');
  });
});
