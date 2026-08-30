import {
  isSensitiveKey,
  scrubString,
  scrubValue,
  stripQueryString,
  sanitizeSentryEvent,
  sanitizeBreadcrumb,
} from './sentry-sanitize';

describe('isSensitiveKey', () => {
  it.each([
    'Authorization',
    'accessToken',
    'refreshToken',
    'Cookie',
    'password',
    'otpCode',
    'apiSecret',
    'api_key',
    'apiKey',
    'sessionId',
    'paymentMethod',
    'financialSummary',
    'cardNumber',
    'bankAccount',
    'ibanNumber',
    'phoneNumber',
    'email',
  ])('flags %s as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['method', 'route', 'status', 'environment', 'release', 'errorName', 'stack'])(
    'does not flag %s as sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe('scrubString — pattern-based redaction with no key required', () => {
  it.each([
    ['Authorization: Bearer secret-token-abc123', 'secret-token-abc123'],
    ['x-api-key: sk_live_51ABCDEF', 'sk_live_51ABCDEF'],
    ['X-Api_Key=sk_live_weirdcase', 'sk_live_weirdcase'],
    ['access_token=abc.def.ghi', 'abc.def.ghi'],
    ['refresh_token: zzz999', 'zzz999'],
    ['Cookie: sid=abc123; Path=/; HttpOnly', 'sid=abc123'],
    ['password: hunter2', 'hunter2'],
    ['bank_account: 000123456789', '000123456789'],
    ['iban: AM231234567890123456789012', 'AM231234567890123456789012'],
    ['card_number: 4111111111111111', '4111111111111111'],
  ])('redacts the value half of %s', (input, secret) => {
    const result = scrubString(input);
    expect(result).not.toContain(secret);
    expect(result).toContain('[Filtered]');
  });

  it('redacts a bare Bearer token with no "Authorization" label at all', () => {
    const result = scrubString('leaked value was Bearer abc.def.ghi in the log');
    expect(result).not.toContain('abc.def.ghi');
  });

  it('redacts a JWT-shaped token even with no keyword nearby', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scrubString(`extracted from ${jwt}`);
    expect(result).not.toContain(jwt);
  });

  it('redacts an OTP given as "OTP <digits>"', () => {
    expect(scrubString('OTP 482913 expired')).not.toContain('482913');
  });

  it('redacts an OTP given as "<digits> is your otp"', () => {
    expect(scrubString('482913 is your otp code')).not.toContain('482913');
  });

  it('redacts an email address wherever it appears', () => {
    expect(scrubString('issued for user a@b.com just now')).not.toContain('a@b.com');
  });

  it('redacts a phone number wherever it appears', () => {
    expect(scrubString('call +37455512345 back')).not.toContain('37455512345');
  });

  it('redacts a card number wherever it appears, spaced or not', () => {
    expect(scrubString('card 4111 1111 1111 1111 declined')).not.toContain('4111 1111 1111 1111');
    expect(scrubString('card 4111111111111111 declined')).not.toContain('4111111111111111');
  });

  it('redacts a bank/IBAN-style account number wherever it appears', () => {
    expect(scrubString('payout to AM231234567890123456789012 failed')).not.toContain(
      'AM231234567890123456789012',
    );
  });

  it('leaves an ordinary sentence containing a sensitive-looking word untouched', () => {
    expect(scrubString('Access denied: contact support')).toBe('Access denied: contact support');
    expect(scrubString('session ended normally')).toBe('session ended normally');
  });

  it('leaves a short diagnostic number untouched', () => {
    expect(scrubString('HTTP 500 on /v1/users/42')).toBe('HTTP 500 on /v1/users/42');
    expect(scrubString('retried 3 times')).toBe('retried 3 times');
  });

  it('leaves a letters-only verification marker untouched', () => {
    const marker = 'tutak-api-sentry-verify-abcdefghij';
    expect(scrubString(`TuTak Sentry verification: ${marker}`)).toBe(
      `TuTak Sentry verification: ${marker}`,
    );
  });
});

describe('scrubValue', () => {
  it('redacts a sensitive key at the top level', () => {
    expect(scrubValue({ password: 'hunter2' })).toEqual({ password: '[Filtered]' });
  });

  it('redacts sensitive keys nested arbitrarily deep', () => {
    const input = {
      user: {
        profile: {
          credentials: { accessToken: 'abc.def.ghi', refreshToken: 'xyz' },
        },
      },
    };
    expect(scrubValue(input)).toEqual({
      user: {
        profile: {
          credentials: { accessToken: '[Filtered]', refreshToken: '[Filtered]' },
        },
      },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const input = { breadcrumbs: [{ category: 'auth', data: { refreshToken: 'xyz' } }] };
    expect(scrubValue(input)).toEqual({
      breadcrumbs: [{ category: 'auth', data: { refreshToken: '[Filtered]' } }],
    });
  });

  it('also scrubs a secret sitting in a plain string inside an array, with no sensitive key at all', () => {
    const input = { notes: ['Authorization: Bearer secret-abc', 'harmless note'] };
    const result = scrubValue(input) as { notes: string[] };
    expect(result.notes[0]).not.toContain('secret-abc');
    expect(result.notes[1]).toBe('harmless note');
  });

  it('leaves non-sensitive nested data untouched', () => {
    const input = { http: { method: 'POST', route: '/v1/users/:id', status: 500 } };
    expect(scrubValue(input)).toEqual(input);
  });

  it('does not loop forever on a circular reference', () => {
    const input: Record<string, unknown> = { a: 1 };
    input.self = input;
    expect(() => scrubValue(input)).not.toThrow();
  });
});

describe('stripQueryString', () => {
  it('drops everything from the first ? onward', () => {
    expect(stripQueryString('/v1/users/123?otp=445566&token=abc')).toBe('/v1/users/123');
  });

  it('leaves a url with no query string unchanged', () => {
    expect(stripQueryString('/v1/health')).toBe('/v1/health');
  });

  it('passes through undefined', () => {
    expect(stripQueryString(undefined)).toBeUndefined();
  });
});

describe('sanitizeSentryEvent — allowlist rebuild', () => {
  it('never lets a request body through, under any key', () => {
    const event = { request: { url: '/v1/auth/login', data: { password: 'hunter2', cardNumber: '4111111111111111' } } };
    const result = sanitizeSentryEvent(event);
    expect(result.request?.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('4111111111111111');
  });

  it('drops the query string, cookies, and every request header — not just ones with sensitive names', () => {
    const event = {
      request: {
        method: 'GET',
        url: '/v1/wallet/me?token=abc123',
        cookies: { refreshToken: 'xyz' },
        query_string: 'token=abc123',
        headers: { Authorization: 'Bearer eyJhbGciOi...', 'x-request-id': 'abc', 'x-custom-app-header': 'still gone' },
      },
    };
    const result = sanitizeSentryEvent(event);
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
    expect(result.request?.headers).toBeUndefined();
    expect(result.request?.method).toBe('GET');
    expect(result.request?.url).toBe('/v1/wallet/me');
  });

  it('removes the complete user object, not just ip/email', () => {
    const event = { user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com', username: 'alice' } };
    const result = sanitizeSentryEvent(event);
    expect(result.user).toBeUndefined();
  });

  it('removes arbitrary extra entirely, whatever it contains', () => {
    const event = { extra: { env: { JWT_ACCESS_SECRET: 'x' }, note: 'kept?', phone: '+37455512345' } };
    const result = sanitizeSentryEvent(event);
    expect(result.extra).toBeUndefined();
  });

  it('removes arbitrary contexts entirely', () => {
    const event = { contexts: { runtime: { name: 'node' }, custom: { ssn: '123-45-6789' } } };
    const result = sanitizeSentryEvent(event);
    expect(result.contexts).toBeUndefined();
  });

  it('scrubs a secret embedded in the top-level message, not just under a recognised key', () => {
    const event = { message: 'Authorization: Bearer secret-token-abc123' };
    const result = sanitizeSentryEvent(event);
    expect(JSON.stringify(result)).not.toContain('secret-token-abc123');
  });

  it('scrubs a secret embedded in the exception value', () => {
    const event = {
      exception: {
        values: [{ type: 'Error', value: 'login failed for x-api-key: sk_live_51ABCDEF' }],
      },
    };
    const result = sanitizeSentryEvent(event);
    expect(JSON.stringify(result)).not.toContain('sk_live_51ABCDEF');
    expect(result.exception?.values?.[0]?.type).toBe('Error');
  });

  it('scrubs a secret embedded in a stack frame\'s source context line', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: 'auth.ts',
                  lineno: 12,
                  colno: 4,
                  context_line: 'const authHeader = "Authorization: Bearer secret-abc";',
                },
              ],
            },
          },
        ],
      },
    };
    const result = sanitizeSentryEvent(event);
    const frame = result.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.context_line).not.toContain('secret-abc');
    expect(frame?.filename).toBe('auth.ts');
    expect(frame?.lineno).toBe(12);
  });

  it('drops arbitrary local variables captured on a stack frame', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: { frames: [{ filename: 'x.ts', vars: { password: 'hunter2' } }] },
          },
        ],
      },
    };
    const result = sanitizeSentryEvent(event);
    const frame = result.exception?.values?.[0]?.stacktrace?.frames?.[0] as Record<string, unknown>;
    expect(frame.vars).toBeUndefined();
  });

  it('scrubs a secret embedded in a breadcrumb message reached through the event', () => {
    const event = { breadcrumbs: [{ category: 'console', message: 'password: hunter2 rejected' }] };
    const result = sanitizeSentryEvent(event);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('drops arbitrary breadcrumb data reached through the event', () => {
    const event = {
      breadcrumbs: [{ category: 'xhr', data: { headers: { cookie: 'sid=abc' }, body: 'raw body' } }],
    };
    const result = sanitizeSentryEvent(event);
    expect(result.breadcrumbs?.[0]?.data).toBeUndefined();
  });

  it('scrubs secrets nested inside an array under extra — even though extra itself is then dropped', () => {
    // Belt and braces: extra disappears wholesale, but scrubValue would also
    // have caught this if some future call site attached the same array
    // under an allowlisted field instead.
    const nested = { list: ['Authorization: Bearer secret-abc', { password: 'hunter2' }] };
    const scrubbed = scrubValue(nested) as { list: unknown[] };
    expect(JSON.stringify(scrubbed)).not.toContain('secret-abc');
    expect(JSON.stringify(scrubbed)).not.toContain('hunter2');
  });

  it('keeps the allow-listed metadata untouched: environment, release, tags, error type/message/stack, HTTP method/route/status', () => {
    const event = {
      environment: 'production',
      release: 'abc1234',
      tags: { service: 'api', 'http.method': 'GET', 'http.route': '/v1/users/:id', 'http.status_code': 500 },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: { frames: [{ filename: 'x.ts', function: 'handler', lineno: 1, colno: 1, in_app: true }] },
          },
        ],
      },
      request: { method: 'GET', url: '/v1/users/123' },
    };
    const result = sanitizeSentryEvent(structuredClone(event));
    expect(result.environment).toBe('production');
    expect(result.release).toBe('abc1234');
    expect(result.tags).toEqual(event.tags);
    expect(result.exception).toEqual(event.exception);
    expect(result.request).toEqual({ method: 'GET', url: '/v1/users/123' });
  });

  it('keeps an explicit verification marker readable end to end', () => {
    const event = {
      exception: {
        values: [{ type: 'Error', value: 'TuTak Sentry verification: tutak-api-sentry-verify-abcdefghij' }],
      },
    };
    const result = sanitizeSentryEvent(event);
    expect(result.exception?.values?.[0]?.value).toBe(
      'TuTak Sentry verification: tutak-api-sentry-verify-abcdefghij',
    );
  });
});

describe('sanitizeBreadcrumb — allowlist rebuild', () => {
  it('drops data entirely — a request body, a cookie header, a credential-bearing URL do not survive under any shape', () => {
    const breadcrumb = {
      category: 'xhr',
      data: {
        url: '/v1/auth/refresh?token=abc',
        body: '{"password":"x"}',
        headers: { cookie: 'refreshToken=xyz' },
      },
    };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect(result.data).toBeUndefined();
  });

  it('scrubs a secret embedded in the breadcrumb message, with no sensitive key involved', () => {
    const breadcrumb = { category: 'console', message: 'Authorization: Bearer secret-token' };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect(result.message).not.toContain('secret-token');
  });

  it('keeps category/level/timestamp/type untouched', () => {
    const breadcrumb = { category: 'navigation', level: 'info', timestamp: 12345, type: 'default', message: 'ok' };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect(result.category).toBe('navigation');
    expect(result.level).toBe('info');
    expect(result.timestamp).toBe(12345);
    expect(result.type).toBe('default');
    expect(result.message).toBe('ok');
  });
});
