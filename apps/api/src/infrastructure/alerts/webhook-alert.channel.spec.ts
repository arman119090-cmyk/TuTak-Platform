import { WebhookAlertChannel } from './webhook-alert.channel';

/**
 * The channel's word has to be the receiver's word.
 *
 * Every alert that matters — a dead-lettered payment callback, a ledger that
 * disagrees with itself — ends here. If this channel reports "delivered" for
 * a POST the receiver rejected or never got, `alert:verify` certifies a dead
 * channel and the first real incident goes nowhere. So: delivered means 2xx,
 * and nothing else.
 */
describe('WebhookAlertChannel', () => {
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

  const answering = (status: number, statusText = '') => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, statusText });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('reports delivered only when the receiver accepted the POST', async () => {
    const fetchMock = answering(200);
    const result = await new WebhookAlertChannel('https://hooks.example/x', 'production').send(alert);

    expect(result).toEqual({ delivered: true, detail: 'webhook answered 200' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example/x');
    expect(init.method).toBe('POST');
    // The payload names the environment, so a staging alert cannot be
    // mistaken for production at three in the morning.
    expect(JSON.parse(String(init.body))).toMatchObject({
      key: alert.key,
      severity: 'critical',
      environment: 'production',
    });
  });

  it('reports not delivered when the receiver rejects it', async () => {
    answering(500, 'Internal Server Error');
    const result = await new WebhookAlertChannel('https://hooks.example/x', 'production').send(alert);

    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/500/);
  });

  it('reports not delivered, and does not throw, when the receiver is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const result = await new WebhookAlertChannel('https://hooks.example/x', 'production').send(alert);

    // Never rejects: an alert fires from code that is already handling a
    // problem, and a throw here would lose both the finding and the alert.
    expect(result).toEqual({ delivered: false, detail: 'webhook unreachable: fetch failed', retryable: true });
  });
});
