import { ServiceUnavailableException } from '@nestjs/common';
import { VivaSmsProvider, toVivaSubscriberNumber } from './viva-sms.provider';
import { selectSmsTransport, missingVivaSettings, SmsTransportOptions } from './sms-transport';

/**
 * The Viva Business Hub integration, checked against the request shapes its
 * integration document specifies.
 *
 * These assertions are on the *wire format*, deliberately. Every field here
 * is one Viva reads and this codebase cannot verify: a `params_data` sent as
 * an object rather than a JSON-encoded string, or a recipient still carrying
 * its `+374`, is a request that is accepted or rejected by somebody else's
 * server for reasons no test of ours would otherwise see.
 */

const CONFIG = {
  baseUrl: 'https://businesshubapi.viva.am/api/v1',
  clientId: '1',
  clientSecret: 'secret',
  username: 'user@viva.am',
  password: 'password',
  senderName: 'TuTak',
  templateName: 'VerificationCode',
  sendUtf: true,
};

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchMock = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () => Promise.resolve(next.body ?? {}),
      text: () => Promise.resolve(JSON.stringify(next.body ?? {})),
    } as unknown as Response);
  });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  return calls;
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as Record<string, unknown>;
const headersOf = (call: Call) => call.init.headers as Record<string, string>;

describe('toVivaSubscriberNumber', () => {
  it('drops the Armenian country code, which Viva does not want', () => {
    // Viva's own example addresses `93600600`. We store `+37493600600`.
    expect(toVivaSubscriberNumber('+37493600600')).toBe('93600600');
    expect(toVivaSubscriberNumber('+37494600600')).toBe('94600600');
  });

  it('leaves a foreign number alone rather than guessing a prefix', () => {
    // A wrong guess sends someone else's phone a verification code.
    expect(toVivaSubscriberNumber('+995322000000')).toBe('995322000000');
  });

  it('tolerates surrounding whitespace', () => {
    expect(toVivaSubscriberNumber('  +37493600600 ')).toBe('93600600');
  });
});

describe('VivaSmsProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('authenticates, then sends the template and the code', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'access-1', refresh_token: 'refresh-1' } },
      { status: 200, body: { trx_unique_id: '642ebd4156c19' } },
    ]);

    const result = await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'TuTak: your verification code is 123456',
      templateParams: ['123456'],
    });

    expect(calls).toHaveLength(2);

    const auth = calls[0]!;
    expect(auth.url).toBe('https://businesshubapi.viva.am/api/v1/token/get');
    expect(bodyOf(auth)).toEqual({
      client_id: '1',
      client_secret: 'secret',
      username: 'user@viva.am',
      password: 'password',
      scopes: ['transact'],
    });

    const send = calls[1]!;
    expect(send.url).toBe('https://businesshubapi.viva.am/api/v1/transact/send/batch');
    expect(headersOf(send).Authorization).toBe('Bearer access-1');
    expect(bodyOf(send)).toEqual({
      sender_name: 'TuTak',
      template_name: 'VerificationCode',
      // A JSON-encoded *string*, per the document — not a nested object.
      params_data: '{"93600600":["123456"]}',
      send_utf: 1,
    });

    expect(result.providerMessageId).toBe('642ebd4156c19');
  });

  it('never puts the message text on the wire', async () => {
    // Viva cannot send text at all. If `body` ever reached the request it
    // would be silently ignored by them and misleading to us.
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 200, body: {} },
    ]);

    await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'TuTak: your verification code is 123456',
      templateParams: ['123456'],
    });

    expect(String(calls[1]!.init.body)).not.toContain('your verification code is');
  });

  it('reuses the access token across sends instead of re-authenticating', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);

    const provider = new VivaSmsProvider(CONFIG);
    const message = { to: '+37493600600', body: 'x', templateParams: ['1'] };
    await provider.send(message);
    await provider.send(message);

    expect(calls.filter((c) => c.url.endsWith('/token/get'))).toHaveLength(1);
  });

  it('authenticates once for a burst rather than once per send', async () => {
    // Without a single in-flight promise, the first burst after a restart
    // sends one token/get per concurrent send — at an endpoint that is
    // exactly the sort of thing that rate limits.
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);

    const provider = new VivaSmsProvider(CONFIG);
    const message = { to: '+37493600600', body: 'x', templateParams: ['1'] };
    await Promise.all([provider.send(message), provider.send(message), provider.send(message)]);

    expect(calls.filter((c) => c.url.endsWith('/token/get'))).toHaveLength(1);
  });

  it('re-authenticates once and retries when the token has expired', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'stale' } },
      { status: 401, body: { error: 'expired' } },
      { status: 200, body: { access_token: 'fresh' } },
      { status: 200, body: { trx_unique_id: 'trx' } },
    ]);

    const result = await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['123456'],
    });

    expect(calls).toHaveLength(4);
    expect(headersOf(calls[3]!).Authorization).toBe('Bearer fresh');
    expect(result.providerMessageId).toBe('trx');
  });

  it('gives up after a second 401 instead of looping', async () => {
    // A second 401 is a credentials problem, not a stale token.
    stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 401 },
      { status: 200, body: { access_token: 'b' } },
      { status: 401 },
    ]);

    await expect(
      new VivaSmsProvider(CONFIG).send({ to: '+37493600600', body: 'x', templateParams: ['1'] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a message with no template parameters rather than sending an empty one', async () => {
    const calls = stubFetch([{ status: 200, body: { access_token: 'a' } }]);

    await expect(
      new VivaSmsProvider(CONFIG).send({ to: '+37493600600', body: 'some text' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // And it does not spend a round trip finding that out.
    expect(calls).toHaveLength(0);
  });

  it('treats an accepted send with an unrecognised body as sent', async () => {
    // The document describes no response body. A send the carrier accepted
    // must not be reported as failed because a field was named differently.
    stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 200, body: { something: 'else' } },
    ]);

    const result = await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['1'],
    });

    expect(result.providerMessageId).toBeNull();
  });

  it('never leaks the carrier error text to the caller', async () => {
    // It can name the account and the template.
    stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 422, body: { message: 'template VerificationCode not found for user@viva.am' } },
    ]);

    await expect(
      new VivaSmsProvider(CONFIG).send({ to: '+37493600600', body: 'x', templateParams: ['1'] }),
    ).rejects.toThrow('Could not send the SMS message');
  });

  it('sends send_utf 0 only when explicitly turned off', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a' } },
      { status: 200, body: {} },
    ]);

    await new VivaSmsProvider({ ...CONFIG, sendUtf: false }).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['1'],
    });

    expect(bodyOf(calls[1]!).send_utf).toBe(0);
  });
});

describe('selecting the Viva transport', () => {
  const base: SmsTransportOptions = {
    appEnv: 'production',
    demoMode: false,
    driver: 'viva',
    endpoint: 'https://businesshubapi.viva.am/api/v1',
    authScheme: 'basic',
    username: 'user@viva.am',
    token: 'password',
    sender: 'TuTak',
    encoding: 'json',
    viva: { clientId: '1', clientSecret: 'secret', templateName: 'Code', sendUtf: true },
  };

  it('is chosen by name', () => {
    expect(selectSmsTransport(base).name).toBe('viva');
  });

  it('names every missing setting rather than failing on the first', () => {
    const missing = missingVivaSettings({
      ...base,
      endpoint: '',
      username: '',
      viva: { ...base.viva, templateName: '' },
    });
    expect(missing).toEqual(['SMS_ENDPOINT', 'SMS_USERNAME', 'SMS_VIVA_TEMPLATE_NAME']);
  });

  it('refuses to boot on an incomplete configuration, in every environment', () => {
    // Somebody who asked for Viva by name and did not get it has a
    // deployment that cannot sign anyone in.
    for (const appEnv of ['development', 'staging', 'production'] as const) {
      expect(() =>
        selectSmsTransport({ ...base, appEnv, viva: { ...base.viva, clientId: '' } }),
      ).toThrow(/SMS_VIVA_CLIENT_ID/);
    }
  });

  it('tolerates a trailing slash on the base URL', () => {
    // `${baseUrl}/token/get` would otherwise become a double slash.
    const provider = selectSmsTransport({ ...base, endpoint: `${base.endpoint}/` });
    expect(provider.name).toBe('viva');
  });

  it('leaves the generic HTTP transport untouched', () => {
    expect(selectSmsTransport({ ...base, driver: 'http' }).name).toBe('http');
  });
});
