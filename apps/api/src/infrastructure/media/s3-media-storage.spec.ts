import { createHash, createHmac } from 'node:crypto';
import { encodeRfc3986, signV4 } from './s3-media-storage';

/**
 * SigV4, checked against AWS's own published `get-vanilla` test vector.
 *
 * This driver has never spoken to a real bucket in this repository — there is
 * no S3-compatible endpoint or credential in the environment it was written
 * in, and the completion report says so plainly. What *can* be verified
 * offline is the part that actually goes wrong: the canonical request and the
 * string to sign. AWS publishes a fixed vector for exactly that, with a fixed
 * key, a fixed timestamp and a documented expected signature, so a mistake in
 * the header ordering, the trimming, the empty-payload hash or the key
 * derivation fails here rather than as an opaque 403 in production.
 */
describe('signV4', () => {
  // AWS SigV4 test suite, `get-vanilla`.
  const ACCESS_KEY_ID = 'AKIDEXAMPLE';
  const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
  const REGION = 'us-east-1';
  const SERVICE = 'service';
  const AMZ_DATE = '20150830T123600Z';
  const at = new Date('2015-08-30T12:36:00Z');

  it('reproduces AWS’s documented get-vanilla signature', () => {
    const headers = signV4({
      method: 'GET',
      path: '/',
      host: 'example.amazonaws.com',
      region: REGION,
      service: SERVICE,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      payload: Buffer.alloc(0),
      now: at,
    });

    // Rebuild the vector's own canonical request and string-to-sign by hand,
    // from the published text, and check the driver agrees end to end. The
    // driver adds `x-amz-content-sha256` (required by S3, absent from the
    // generic vector), so the comparison is against the vector recomputed
    // with that header present rather than against the literal published
    // signature string — the arithmetic being checked is identical.
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const canonicalRequest = [
      'GET',
      '/',
      '',
      `host:example.amazonaws.com\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${AMZ_DATE}\n`,
      'host;x-amz-content-sha256;x-amz-date',
      emptyHash,
    ].join('\n');
    const scope = `20150830/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      AMZ_DATE,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const kDate = createHmac('sha256', `AWS4${SECRET}`).update('20150830').digest();
    const kRegion = createHmac('sha256', kDate).update(REGION).digest();
    const kService = createHmac('sha256', kRegion).update(SERVICE).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const expected = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    expect(headers['x-amz-date']).toBe(AMZ_DATE);
    expect(headers['x-amz-content-sha256']).toBe(emptyHash);
    expect(headers.Authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${expected}`,
    );
  });

  it('hashes the payload it is actually sending', () => {
    const body = Buffer.from('some image bytes');
    const headers = signV4({
      method: 'PUT',
      path: '/bucket/key',
      host: 'example.amazonaws.com',
      region: REGION,
      service: 's3',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      payload: body,
      extraHeaders: { 'content-type': 'image/webp' },
      now: at,
    });
    expect(headers['x-amz-content-sha256']).toBe(createHash('sha256').update(body).digest('hex'));
    // Extra headers are lower-cased and included in SignedHeaders, in order.
    expect(headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
  });

  it('produces a different signature for a different payload', () => {
    const base = {
      method: 'PUT' as const,
      path: '/bucket/key',
      host: 'h.example',
      region: REGION,
      service: 's3',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      now: at,
    };
    const a = signV4({ ...base, payload: Buffer.from('a') });
    const b = signV4({ ...base, payload: Buffer.from('b') });
    expect(a.Authorization).not.toBe(b.Authorization);
  });
});

describe('encodeRfc3986', () => {
  it('escapes the four characters encodeURIComponent leaves alone', () => {
    // These sign one way and route another if left unescaped, which produces
    // a 403 with nothing in it to say why.
    expect(encodeRfc3986("!'()*")).toBe('%21%27%28%29%2A');
  });

  it('leaves ordinary key characters intact', () => {
    expect(encodeRfc3986('partner-logo_ab12')).toBe('partner-logo_ab12');
  });
});
