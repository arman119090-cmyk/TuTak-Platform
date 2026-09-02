import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  VivaSmsProvider,
  applyAccessToken,
  formatVivaRecipient,
  readTransactionId,
  safeProviderErrorCode,
} from './viva-sms.provider';
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
  numberFormat: 'national' as const,
  tokenPlacement: 'bearer',
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

describe('formatVivaRecipient', () => {
  /**
   * The document settles this by one example and no rule. Every shape is
   * therefore reachable from configuration, and none of them re-prefixes a
   * foreign number — a guessed country code sends a stranger a code.
   */
  it('drops the country code under `national`, which is what the example implies', () => {
    expect(formatVivaRecipient('+37493600600', 'national')).toBe('93600600');
    expect(formatVivaRecipient('+37494600600', 'national')).toBe('94600600');
  });

  it('keeps the country code without the plus under `msisdn`', () => {
    expect(formatVivaRecipient('+37493600600', 'msisdn')).toBe('37493600600');
  });

  it('sends exactly what is stored under `e164`', () => {
    expect(formatVivaRecipient('+37493600600', 'e164')).toBe('+37493600600');
  });

  it('never re-prefixes a foreign number, whichever shape is asked for', () => {
    expect(formatVivaRecipient('+995322000000', 'national')).toBe('995322000000');
    expect(formatVivaRecipient('+995322000000', 'msisdn')).toBe('995322000000');
    expect(formatVivaRecipient('+995322000000', 'e164')).toBe('+995322000000');
  });

  it('tolerates surrounding whitespace', () => {
    expect(formatVivaRecipient('  +37493600600 ', 'national')).toBe('93600600');
  });
});

describe('applyAccessToken', () => {
  /**
   * Viva does not document how the token is presented. `bearer` is an
   * inference from the shape of the token endpoints, so every alternative
   * has to be reachable without touching the provider.
   */
  const empty = () => ({ headers: {}, body: { a: 1 }, query: {} });

  it('puts a bearer token in the Authorization header', () => {
    expect(applyAccessToken('bearer', 't', empty()).headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('can put it in a named header instead', () => {
    expect(applyAccessToken('header:X-Access-Token', 't', empty()).headers).toEqual({
      'X-Access-Token': 't',
    });
  });

  it('can put it in the request body', () => {
    expect(applyAccessToken('body:access_token', 't', empty()).body).toEqual({
      a: 1,
      access_token: 't',
    });
  });

  it('can put it in the query string', () => {
    expect(applyAccessToken('query:token', 't', empty()).query).toEqual({ token: 't' });
  });

  it('leaves the other carriers untouched', () => {
    const result = applyAccessToken('header:X-Token', 't', empty());
    expect(result.body).toEqual({ a: 1 });
    expect(result.query).toEqual({});
  });

  it('throws on a placement it does not know rather than falling back', () => {
    // A silent fallback to `bearer` would hide a typo behind a 401 that
    // looks exactly like bad credentials.
    expect(() => applyAccessToken('headers:X', 't', empty())).toThrow(/not a placement/);
    expect(() => applyAccessToken('header:', 't', empty())).toThrow(/not a placement/);
    expect(() => applyAccessToken('', 't', empty())).toThrow(/not a placement/);
  });
});

describe('safeProviderErrorCode', () => {
  /**
   * Viva's error payloads are undocumented, so they could carry an echoed
   * request — the recipient's number, the template, the code. Only a short
   * identifier from a field named like a code is allowed into a log.
   */
  it('takes a short identifier from a code-shaped field', () => {
    expect(safeProviderErrorCode({ code: 'TEMPLATE_NOT_FOUND' })).toBe('TEMPLATE_NOT_FOUND');
    expect(safeProviderErrorCode({ error_code: 'E42' })).toBe('E42');
    expect(safeProviderErrorCode({ statusCode: 422 })).toBe('422');
  });

  it('refuses a sentence, however it is labelled', () => {
    expect(
      safeProviderErrorCode({ code: 'template VerificationCode not found for user@viva.am' }),
    ).toBeNull();
    expect(safeProviderErrorCode({ message: 'sending 123456 to +37493600600 failed' })).toBeNull();
    expect(safeProviderErrorCode({ error: 'the recipient +37493600600 is invalid' })).toBeNull();
  });

  it('refuses anything that is not a scalar code', () => {
    expect(safeProviderErrorCode({ code: { nested: 'x' } })).toBeNull();
    expect(safeProviderErrorCode({ code: ['x'] })).toBeNull();
    expect(safeProviderErrorCode(null)).toBeNull();
    expect(safeProviderErrorCode('a string')).toBeNull();
    expect(safeProviderErrorCode([{ code: 'X' }])).toBeNull();
  });
});

describe('readTransactionId', () => {
  it('reads the documented field', () => {
    expect(readTransactionId({ trx_unique_id: '642ebd4156c19' })).toBe('642ebd4156c19');
  });

  it('looks one level into a data envelope and no deeper', () => {
    expect(readTransactionId({ data: { trx_unique_id: 'x' } })).toBe('x');
    expect(readTransactionId({ data: { data: { trx_unique_id: 'x' } } })).toBeNull();
  });

  it('returns null rather than throwing on any other shape', () => {
    for (const payload of [null, undefined, 'text', 42, [], [{ trx_unique_id: 'x' }], {}, { data: 'x' }, { trx_unique_id: 42 }]) {
      expect(readTransactionId(payload)).toBeNull();
    }
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

  it('uses the documented refresh endpoint before re-authenticating', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'stale', refresh_token: 'r1' } },
      { status: 401, body: { code: 'EXPIRED' } },
      { status: 200, body: { access_token: 'fresh', refresh_token: 'r2' } },
      { status: 200, body: { trx_unique_id: 'trx' } },
    ]);

    const result = await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['123456'],
    });

    expect(calls.map((c) => c.url.replace(CONFIG.baseUrl, ''))).toEqual([
      '/token/get',
      '/transact/send/batch',
      '/token/refresh',
      '/transact/send/batch',
    ]);
    // The refresh call carries the client credentials and the refresh token,
    // exactly as the document specifies — and no username or password.
    expect(bodyOf(calls[2]!)).toEqual({
      client_id: '1',
      client_secret: 'secret',
      refresh_token: 'r1',
    });
    expect(headersOf(calls[3]!).Authorization).toBe('Bearer fresh');
    expect(result.providerMessageId).toBe('trx');
  });

  it('falls back to a full re-authentication when the refresh is refused', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'stale', refresh_token: 'r1' } },
      { status: 401 },
      { status: 400, body: { code: 'REFRESH_EXPIRED' } },
      { status: 200, body: { access_token: 'fresh' } },
      { status: 200, body: { trx_unique_id: 'trx' } },
    ]);

    const result = await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['1'],
    });

    expect(calls.map((c) => c.url.replace(CONFIG.baseUrl, ''))).toEqual([
      '/token/get',
      '/transact/send/batch',
      '/token/refresh',
      '/token/get',
      '/transact/send/batch',
    ]);
    expect(result.providerMessageId).toBe('trx');
  });

  it('skips the refresh endpoint when no refresh token was issued', async () => {
    const calls = stubFetch([
      { status: 200, body: { access_token: 'stale' } },
      { status: 401 },
      { status: 200, body: { access_token: 'fresh' } },
      { status: 200, body: {} },
    ]);

    await new VivaSmsProvider(CONFIG).send({
      to: '+37493600600',
      body: 'x',
      templateParams: ['1'],
    });

    expect(calls.some((c) => c.url.endsWith('/token/refresh'))).toBe(false);
  });

  it('keeps the old refresh token when the refresh response omits a new one', async () => {
    // It is the only one there is; dropping it would force a full
    // re-authentication on the next 401 for no reason.
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a', refresh_token: 'r1' } },
      { status: 401 },
      { status: 200, body: { access_token: 'b' } },
      { status: 200, body: {} },
      { status: 401 },
      { status: 200, body: { access_token: 'c' } },
      { status: 200, body: {} },
    ]);

    const provider = new VivaSmsProvider(CONFIG);
    const message = { to: '+37493600600', body: 'x', templateParams: ['1'] };
    await provider.send(message);
    await provider.send(message);

    const refreshes = calls.filter((c) => c.url.endsWith('/token/refresh'));
    expect(refreshes).toHaveLength(2);
    expect(bodyOf(refreshes[1]!).refresh_token).toBe('r1');
  });

  it('gives up after a second 401 instead of looping', async () => {
    // A second 401 is a credentials or token-placement problem, not a stale
    // token, and retrying it would only double the failures.
    const calls = stubFetch([
      { status: 200, body: { access_token: 'a', refresh_token: 'r' } },
      { status: 401 },
      { status: 200, body: { access_token: 'b' } },
      { status: 401 },
    ]);

    await expect(
      new VivaSmsProvider(CONFIG).send({ to: '+37493600600', body: 'x', templateParams: ['1'] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(calls).toHaveLength(4);
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

  it('logs the status and a safe code, and never the response body', async () => {
    // The single most dangerous line in this file. Viva's error payloads are
    // undocumented and could echo the request — the recipient's number and
    // the code itself. "Log it all, redact later" is how that becomes
    // permanent.
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });

    stubFetch([
      { status: 200, body: { access_token: 'a' } },
      {
        status: 422,
        body: {
          code: 'TEMPLATE_NOT_FOUND',
          message: 'template VerificationCode not found for user@viva.am',
          request: { params_data: '{"93600600":["123456"]}' },
        },
      },
    ]);

    await expect(
      new VivaSmsProvider(CONFIG).send({
        to: '+37493600600',
        body: 'TuTak: your verification code is 123456',
        templateParams: ['123456'],
      }),
    ).rejects.toThrow('Could not send the SMS message');

    const all = logged.join(' | ');
    expect(all).toContain('HTTP 422');
    expect(all).toContain('TEMPLATE_NOT_FOUND');
    for (const secret of ['123456', '93600600', '+37493600600', 'user@viva.am', 'not found for']) {
      expect(all).not.toContain(secret);
    }
  });

  it('never logs the credentials when authentication is refused', async () => {
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });

    stubFetch([{ status: 401, body: { code: 'BAD_CREDENTIALS', echoed: 'password' } }]);

    await expect(
      new VivaSmsProvider(CONFIG).send({ to: '+37493600600', body: 'x', templateParams: ['1'] }),
    ).rejects.toThrow('Could not send the SMS message');

    const all = logged.join(' | ');
    expect(all).toContain('HTTP 401');
    expect(all).not.toContain('password');
    expect(all).not.toContain('secret');
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
    viva: {
      clientId: '1',
      clientSecret: 'secret',
      templateName: 'Code',
      sendUtf: true,
      numberFormat: 'national',
      tokenPlacement: 'bearer',
    },
  };

  it('is chosen by name', () => {
    expect(selectSmsTransport(base).name).toBe('viva');
  });

  it('names every missing setting rather than failing on the first', () => {
    const missing = missingVivaSettings({
      ...base,
      endpoint: '',
      username: '',
      viva: { ...base.viva, templateName: '', numberFormat: '' },
    });
    expect(missing).toEqual([
      'SMS_ENDPOINT',
      'SMS_USERNAME',
      'SMS_VIVA_TEMPLATE_NAME',
      'SMS_VIVA_NUMBER_FORMAT',
    ]);
  });

  it('will not boot without the number format being stated', () => {
    // The one setting the integration document does not specify. Guessing it
    // costs nothing at boot and everything at delivery.
    expect(() =>
      selectSmsTransport({ ...base, viva: { ...base.viva, numberFormat: '' } }),
    ).toThrow(/SMS_VIVA_NUMBER_FORMAT/);
  });

  it('rejects a number format it does not implement', () => {
    expect(() =>
      selectSmsTransport({ ...base, viva: { ...base.viva, numberFormat: 'local' } }),
    ).toThrow(/must be one of national, msisdn, e164/);
  });

  it.each(['national', 'msisdn', 'e164'])('accepts the %s number format', (numberFormat) => {
    expect(selectSmsTransport({ ...base, viva: { ...base.viva, numberFormat } }).name).toBe('viva');
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
