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
