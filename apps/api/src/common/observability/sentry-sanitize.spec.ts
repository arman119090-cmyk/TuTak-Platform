import {
  ALLOWED_TAG_KEYS,
  FALLBACK_ERROR_TYPE,
  safeErrorType,
  sanitizeSentryEvent,
  sanitizeBreadcrumb,
} from './sentry-sanitize';

/**
 * Every value below must be absent from the serialized output. Asserting on
 * `JSON.stringify(result)` rather than on a specific field is deliberate:
 * the claim being tested is "this string does not leave the process", not
 * "this string is not in the field I remembered to check".
 */
const RAW_PATH_WITH_NAME = '/v1/users/Арман';
const RAW_PATH_WITH_ACCOUNT = '/v1/customers/123456789';
const PASSWORD = 'password hunter2';
const OPAQUE_TOKEN = 'Zx9QpLm2Vt7RhK4NsE1BgYcW';
const CUSTOMER_NAME = 'Арман Петросян';

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe('safeErrorType', () => {
  it.each([
    'Error',
    'TypeError',
    'PrismaClientKnownRequestError',
    'SentryVerificationProbe',
    '_private$Thing',
  ])('keeps %s, which is a class name', (type) => {
    expect(safeErrorType(type)).toBe(type);
  });

  it.each([
    ['a sentence', 'not a class name!'],
    ['an error message', 'Error: password hunter2'],
    ['a raw path', RAW_PATH_WITH_NAME],
    ['an empty string', ''],
    ['something absurdly long', 'A'.repeat(200)],
  ])('replaces %s with Error', (_label, type) => {
    expect(safeErrorType(type)).toBe(FALLBACK_ERROR_TYPE);
  });

  it.each([undefined, null, 42, {}, []])('replaces the non-string %p with Error', (type) => {
    expect(safeErrorType(type)).toBe(FALLBACK_ERROR_TYPE);
  });
});

describe('sanitizeSentryEvent — the request object', () => {
  it('drops the whole request object, raw path included', () => {
    const event = {
      request: {
        method: 'GET',
        url: `${RAW_PATH_WITH_NAME}?otp=482913`,
        headers: { authorization: 'Bearer secret', 'x-api-key': 'sk_live_abc' },
        cookies: { sid: 'abc123' },
        query_string: 'otp=482913',
        data: { password: 'hunter2', cardNumber: '4111 1111 1111 1111' },
      },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.request).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops a raw path carrying an account number', () => {
    const event = { request: { url: RAW_PATH_WITH_ACCOUNT } };

    expect(serialized(sanitizeSentryEvent(event))).not.toContain('123456789');
  });
});

describe('sanitizeSentryEvent — free text', () => {
  it('drops the root message', () => {
    const event = { message: `${PASSWORD} rejected for ${CUSTOMER_NAME}` };

    const result = sanitizeSentryEvent(event);

    expect(result.message).toBeUndefined();
    expect(serialized(result)).not.toContain('hunter2');
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops a structured message object as well as a plain one', () => {
    const event = { message: { message: PASSWORD, formatted: PASSWORD, params: [OPAQUE_TOKEN] } };

    const result = sanitizeSentryEvent(event);

    expect(result.message).toBeUndefined();
    expect(serialized(result)).not.toContain('hunter2');
    expect(serialized(result)).not.toContain(OPAQUE_TOKEN);
  });

  it('drops the exception value — the error message — while keeping the type', () => {
    const event = {
      exception: {
        values: [{ type: 'PrismaClientKnownRequestError', value: `${PASSWORD} for ${RAW_PATH_WITH_ACCOUNT}` }],
      },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.exception?.values?.[0]?.value).toBeUndefined();
    expect(result.exception?.values?.[0]?.type).toBe('PrismaClientKnownRequestError');
    expect(serialized(result)).not.toContain('hunter2');
    expect(serialized(result)).not.toContain('123456789');
  });

  it('replaces an error type that is not a class name rather than passing it through', () => {
    const event = { exception: { values: [{ type: `Error: ${PASSWORD}`, value: 'boom' }] } };

    const result = sanitizeSentryEvent(event);

    expect(result.exception?.values?.[0]?.type).toBe('Error');
    expect(serialized(result)).not.toContain('hunter2');
  });

  it('drops an unlabelled opaque token that no pattern would have recognised', () => {
    const event = {
      message: OPAQUE_TOKEN,
      exception: { values: [{ type: 'Error', value: OPAQUE_TOKEN }] },
    };

    expect(serialized(sanitizeSentryEvent(event))).not.toContain(OPAQUE_TOKEN);
  });

  it('drops the fingerprint', () => {
    const event = { fingerprint: ['customer', CUSTOMER_NAME] };

    const result = sanitizeSentryEvent(event);

    expect(result.fingerprint).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });
});

describe('sanitizeSentryEvent — stack frames', () => {
  const frameEvent = {
    exception: {
      values: [
        {
          type: 'Error',
          value: 'boom',
          mechanism: { type: 'generic', handled: false, data: { framework: 'express' } },
          stacktrace: {
            frames: [
              {
                filename: 'auth.ts',
                function: 'login',
                module: 'app.auth',
                lineno: 10,
                colno: 3,
                in_app: true,
                context_line: `const key = "${OPAQUE_TOKEN}";`,
                pre_context: [`// customer ${CUSTOMER_NAME}`],
                post_context: ['return key;'],
                vars: { password: 'hunter2' },
              },
            ],
          },
        },
      ],
    },
  };

  it('drops a secret sitting in the failing line of source', () => {
    const result = sanitizeSentryEvent(structuredClone(frameEvent));
    const frame = result.exception?.values?.[0]?.stacktrace?.frames?.[0] as Record<string, unknown>;

    expect(frame.context_line).toBeUndefined();
    expect(frame.pre_context).toBeUndefined();
    expect(frame.post_context).toBeUndefined();
    expect(serialized(result)).not.toContain(OPAQUE_TOKEN);
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops frame-local variables', () => {
    const result = sanitizeSentryEvent(structuredClone(frameEvent));
    const frame = result.exception?.values?.[0]?.stacktrace?.frames?.[0] as Record<string, unknown>;

    expect(frame.vars).toBeUndefined();
    expect(serialized(result)).not.toContain('hunter2');
  });

  it('keeps the structural metadata that locates the throw site', () => {
    const result = sanitizeSentryEvent(structuredClone(frameEvent));

    expect(result.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: 'auth.ts',
      function: 'login',
      module: 'app.auth',
      lineno: 10,
      colno: 3,
      in_app: true,
    });
  });

  it('keeps mechanism type and handled, and drops the rest of the mechanism', () => {
    const result = sanitizeSentryEvent(structuredClone(frameEvent));

    expect(result.exception?.values?.[0]?.mechanism).toEqual({ type: 'generic', handled: false });
  });
});

describe('sanitizeSentryEvent — tags', () => {
  it('keeps exactly the allowlisted tags and drops every other one', () => {
    const event = {
      tags: {
        service: 'api',
        kind: 'sentry-verify',
        'http.method': 'GET',
        'http.route': '/v1/users/:id',
        'http.status_code': 500,
        customerName: CUSTOMER_NAME,
        rawPath: RAW_PATH_WITH_NAME,
        opaque: OPAQUE_TOKEN,
      },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.tags).toEqual({
      service: 'api',
      kind: 'sentry-verify',
      'http.method': 'GET',
      'http.route': '/v1/users/:id',
      'http.status_code': 500,
    });
    expect(serialized(result)).not.toContain('customerName');
    expect(serialized(result)).not.toContain('Арман');
    expect(serialized(result)).not.toContain(OPAQUE_TOKEN);
  });

  it('drops an arbitrary tag whose key merely resembles an allowlisted one', () => {
    const event = {
      tags: { 'http.route.raw': RAW_PATH_WITH_NAME, service_name: CUSTOMER_NAME, Service: 'x' },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.tags).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops an allowlisted key whose value is not a scalar', () => {
    const event = { tags: { service: { nested: CUSTOMER_NAME } } };

    const result = sanitizeSentryEvent(event);

    expect(result.tags).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });

  it('names the five keys the policy allows, so a change to the list is a visible diff', () => {
    expect([...ALLOWED_TAG_KEYS]).toEqual([
      'service',
      'kind',
      'http.method',
      'http.route',
      'http.status_code',
    ]);
  });
});

describe('sanitizeSentryEvent — the arbitrary containers', () => {
  it('drops the complete user object', () => {
    const event = {
      user: { id: 'u1', ip_address: '1.2.3.4', email: 'a@b.com', username: CUSTOMER_NAME },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.user).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops extra entirely', () => {
    const event = { extra: { env: { JWT_ACCESS_SECRET: 'x' }, note: CUSTOMER_NAME } };

    const result = sanitizeSentryEvent(event);

    expect(result.extra).toBeUndefined();
    expect(serialized(result)).not.toContain('Арман');
  });

  it('drops contexts entirely', () => {
    const event = { contexts: { runtime: { name: 'node' }, custom: { ssn: '123-45-6789' } } };

    const result = sanitizeSentryEvent(event);

    expect(result.contexts).toBeUndefined();
    expect(serialized(result)).not.toContain('123-45-6789');
  });
});

describe('sanitizeSentryEvent — what survives', () => {
  it('keeps the safe diagnostics an operator actually works from', () => {
    const event = {
      event_id: 'abc123',
      timestamp: 1700000000,
      platform: 'node',
      level: 'error',
      environment: 'production',
      release: 'deadbeef',
      tags: {
        service: 'api',
        'http.method': 'GET',
        'http.route': '/v1/users/:id',
        'http.status_code': 500,
      },
      exception: {
        values: [
          {
            type: 'PrismaClientKnownRequestError',
            stacktrace: { frames: [{ filename: 'users.service.ts', function: 'findOne', lineno: 42 }] },
          },
        ],
      },
    };

    expect(sanitizeSentryEvent(structuredClone(event))).toEqual(event);
  });

  it('keeps the verification probe identifiable by class name and kind tag', () => {
    const event = {
      tags: { service: 'api', kind: 'sentry-verify' },
      exception: {
        values: [{ type: 'SentryVerificationProbe', value: 'TuTak Sentry verification probe' }],
      },
    };

    const result = sanitizeSentryEvent(event);

    expect(result.tags).toEqual({ service: 'api', kind: 'sentry-verify' });
    expect(result.exception?.values?.[0]?.type).toBe('SentryVerificationProbe');
  });
});

describe('sanitizeBreadcrumb', () => {
  it('drops the message and the data, keeping only the timeline skeleton', () => {
    const breadcrumb = {
      category: 'console',
      level: 'log',
      timestamp: 1700000000,
      type: 'default',
      message: `GET ${RAW_PATH_WITH_ACCOUNT} for ${CUSTOMER_NAME}`,
      data: { url: `${RAW_PATH_WITH_NAME}?token=abc`, body: '{"password":"hunter2"}' },
    };

    const result = sanitizeBreadcrumb(breadcrumb);

    expect(result).toEqual({
      category: 'console',
      level: 'log',
      timestamp: 1700000000,
      type: 'default',
    });
    expect(serialized(result)).not.toContain('Арман');
    expect(serialized(result)).not.toContain('123456789');
    expect(serialized(result)).not.toContain('hunter2');
  });

  it('applies the same rules to a breadcrumb reached through an event', () => {
    const event = {
      breadcrumbs: [
        { category: 'xhr', message: `${RAW_PATH_WITH_NAME} ${OPAQUE_TOKEN}`, data: { body: PASSWORD } },
      ],
    };

    const result = sanitizeSentryEvent(event);

    expect(result.breadcrumbs?.[0]).toEqual({ category: 'xhr' });
    expect(serialized(result)).not.toContain('Арман');
    expect(serialized(result)).not.toContain(OPAQUE_TOKEN);
    expect(serialized(result)).not.toContain('hunter2');
  });
});
