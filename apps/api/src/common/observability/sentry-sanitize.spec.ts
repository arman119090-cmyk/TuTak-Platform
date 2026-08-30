import {
  isSensitiveKey,
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

describe('sanitizeSentryEvent', () => {
  it('never lets a request body through', () => {
    const event = { request: { url: '/v1/auth/login', data: { password: 'hunter2' } } };
    const result = sanitizeSentryEvent(event);
    expect(result.request?.data).toBeUndefined();
  });

  it('strips cookies and the query string from the request', () => {
    const event = {
      request: {
        url: '/v1/wallet/me?token=abc123',
        cookies: { refreshToken: 'xyz' },
        query_string: 'token=abc123',
      },
    };
    const result = sanitizeSentryEvent(event);
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
    expect(result.request?.url).toBe('/v1/wallet/me');
  });

  it('scrubs an Authorization header rather than passing it through', () => {
    const event = {
      request: { headers: { Authorization: 'Bearer eyJhbGciOi...', 'x-request-id': 'abc' } },
    };
    const result = sanitizeSentryEvent(event);
    expect(result.request?.headers?.Authorization).toBe('[Filtered]');
    expect(result.request?.headers?.['x-request-id']).toBe('abc');
  });

  it('removes user IP and email even if something upstream set them', () => {
    const event = { user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com' } };
    const result = sanitizeSentryEvent(event);
    expect(result.user?.ip_address).toBeUndefined();
    expect(result.user?.email).toBeUndefined();
    expect(result.user?.id).toBe('u1');
  });

  it('removes raw environment/config dumps from extra', () => {
    const event = { extra: { env: { JWT_ACCESS_SECRET: 'x' }, note: 'kept' } };
    const result = sanitizeSentryEvent(event);
    expect(result.extra?.env).toBeUndefined();
    expect(result.extra?.note).toBe('kept');
  });

  it('scrubs a financial/payment field wherever it appears', () => {
    const event = { extra: { financialDetails: { cardLast4: '4242' }, paymentToken: 'tok_123' } };
    const result = sanitizeSentryEvent(event);
    expect(result.extra?.financialDetails).toBe('[Filtered]');
    expect(result.extra?.paymentToken).toBe('[Filtered]');
  });

  it('keeps the allow-listed metadata untouched', () => {
    const event = {
      environment: 'production',
      release: 'abc1234',
      tags: { service: 'api', 'http.method': 'GET', 'http.route': '/v1/users/:id', 'http.status_code': 500 },
      exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [] } }] },
    };
    const result = sanitizeSentryEvent(structuredClone(event));
    expect(result.environment).toBe('production');
    expect(result.release).toBe('abc1234');
    expect(result.tags).toEqual(event.tags);
    expect(result.exception).toEqual(event.exception);
  });
});

describe('sanitizeBreadcrumb', () => {
  it('strips the query string from a breadcrumb url', () => {
    const breadcrumb = { category: 'fetch', data: { url: '/v1/auth/refresh?token=abc' } };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect(result.data?.url).toBe('/v1/auth/refresh');
  });

  it('never attaches a request body carried on a breadcrumb', () => {
    const breadcrumb = { category: 'fetch', data: { url: '/v1/auth/login', body: '{"password":"x"}' } };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect(result.data?.body).toBeUndefined();
  });

  it('scrubs a sensitive key nested in breadcrumb data', () => {
    const breadcrumb = { category: 'xhr', data: { headers: { cookie: 'refreshToken=xyz' } } };
    const result = sanitizeBreadcrumb(breadcrumb);
    expect((result.data?.headers as Record<string, unknown>).cookie).toBe('[Filtered]');
  });
});
