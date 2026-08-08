import { ExpoPushProvider } from './expo-push.provider';
import { PushMessage } from './push-provider.interface';

/**
 * The Expo client.
 *
 * The property that matters most is what it does when things go wrong: a
 * notification is a courtesy on top of something that has already happened,
 * so a push service that is down, slow or angry must never turn a completed
 * payment into a failed request. Every failure path here is asserted to
 * resolve.
 */
describe('ExpoPushProvider', () => {
  const config = { endpoint: 'https://push.test/send', accessToken: '' };
  let fetchMock: jest.Mock;

  const message = (to: string): PushMessage => ({ to, title: 'Hello', body: 'World' });

  const ok = (tickets: unknown[]) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: tickets }),
      text: () => Promise.resolve(''),
    } as unknown as Response);

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the batch in the shape Expo expects', async () => {
    fetchMock.mockReturnValue(ok([{ status: 'ok', id: 'ticket-1' }]));
    const provider = new ExpoPushProvider(config);

    const result = await provider.send([
      { to: 'ExponentPushToken[abc]', title: 'Paid', body: '5000 AMD', data: { id: 'n-1' } },
    ]);

    expect(result).toEqual({ invalidTokens: [], delivered: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://push.test/send');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([
      {
        to: 'ExponentPushToken[abc]',
        title: 'Paid',
        body: '5000 AMD',
        data: { id: 'n-1' },
        sound: 'default',
      },
    ]);
  });

  it('sends the access token as a bearer only when one is configured', async () => {
    fetchMock.mockReturnValue(ok([{ status: 'ok' }]));

    await new ExpoPushProvider(config).send([message('ExponentPushToken[a]')]);
    const withoutToken = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(withoutToken.Authorization).toBeUndefined();

    fetchMock.mockClear();
    fetchMock.mockReturnValue(ok([{ status: 'ok' }]));
    await new ExpoPushProvider({ ...config, accessToken: 'secret' }).send([
      message('ExponentPushToken[a]'),
    ]);
    const withToken = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(withToken.Authorization).toBe('Bearer secret');
  });

  it('splits anything over 100 messages into separate requests', async () => {
    // Expo refuses a larger batch outright, so a user base that grows past
    // this silently stops receiving anything if it is not chunked.
    fetchMock.mockImplementation(() => ok(Array.from({ length: 100 }, () => ({ status: 'ok' }))));
    const provider = new ExpoPushProvider(config);

    const messages = Array.from({ length: 250 }, (_, i) => message(`ExponentPushToken[${i}]`));
    await provider.send(messages);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).length,
    );
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('reports tokens Expo says are dead, so they can be forgotten', async () => {
    fetchMock.mockReturnValue(
      ok([
        { status: 'ok' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      ]),
    );
    const provider = new ExpoPushProvider(config);

    const result = await provider.send([
      message('ExponentPushToken[live]'),
      message('ExponentPushToken[dead]'),
    ]);

    expect(result.invalidTokens).toEqual(['ExponentPushToken[dead]']);
    expect(result.delivered).toBe(1);
  });

  it('does not treat every ticket error as a dead token', async () => {
    // A rate limit or a message-too-big is about this send, not about the
    // device — dropping the token would lose a working subscription.
    fetchMock.mockReturnValue(
      ok([{ status: 'error', message: 'too many', details: { error: 'MessageRateExceeded' } }]),
    );

    const result = await new ExpoPushProvider(config).send([message('ExponentPushToken[busy]')]);

    expect(result.invalidTokens).toEqual([]);
    expect(result.delivered).toBe(0);
  });

  it('resolves rather than throwing when Expo returns an error status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('service unavailable'),
      json: () => Promise.resolve({}),
    } as unknown as Response);

    await expect(new ExpoPushProvider(config).send([message('ExponentPushToken[a]')])).resolves.toEqual(
      { invalidTokens: [], delivered: 0 },
    );
  });

  it('resolves rather than throwing when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(new ExpoPushProvider(config).send([message('ExponentPushToken[a]')])).resolves.toEqual(
      { invalidTokens: [], delivered: 0 },
    );
  });

  it('keeps going when one batch fails and another succeeds', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new Error('flaky')))
      .mockImplementationOnce(() => ok(Array.from({ length: 20 }, () => ({ status: 'ok' }))));

    const messages = Array.from({ length: 120 }, (_, i) => message(`ExponentPushToken[${i}]`));
    const result = await new ExpoPushProvider(config).send(messages);

    // The first hundred are lost; the rest still arrive. Failing the whole
    // send because one batch broke would be worse.
    expect(result.delivered).toBe(20);
  });
});
