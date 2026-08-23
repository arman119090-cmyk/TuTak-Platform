import { createHash, createHmac } from 'node:crypto';
import { MediaStorage, StoredObject } from './media-storage.interface';

export interface S3MediaStorageConfig {
  /** e.g. `https://s3.eu-central-1.amazonaws.com` or a MinIO/R2/Spaces host. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Path-style (`https://host/bucket/key`) rather than virtual-hosted
   * (`https://bucket.host/key`). MinIO and most self-hosted S3-compatibles
   * need path-style; AWS itself accepts both.
   */
  forcePathStyle: boolean;
}

/**
 * Durable object storage, spoken directly over HTTP with SigV4.
 *
 * No AWS SDK. This driver needs exactly three verbs against one bucket, all
 * of them single-shot (an image derivative is at most a couple of hundred
 * kilobytes — nothing here needs multipart), and the SDK would add a large
 * transitive dependency tree to an API that otherwise has none of it. SigV4
 * over `fetch` is about eighty lines and is what the SDK would do anyway.
 *
 * ## Honesty about what has and has not been exercised
 *
 * The signing arithmetic below is covered by unit tests, including AWS's own
 * published `get-vanilla` canonical-request/string-to-sign vector, so the
 * signature construction is verified rather than assumed. What is **not**
 * verified is this driver against a live bucket: the environment this was
 * written in has no S3-compatible endpoint and no credentials, by design (see
 * the completion report, docs/MEDIA_SYSTEM_2026-08-23.md). Treat the first
 * deployment that sets `MEDIA_STORAGE_DRIVER=s3` as the integration test, and
 * check `/health`'s reported driver plus one round-trip upload before
 * trusting it with a partner's public identity.
 */
export class S3MediaStorage implements MediaStorage {
  readonly driverName = 's3';

  constructor(private readonly config: S3MediaStorageConfig) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, body, { 'content-type': contentType });
    if (!response.ok) {
      throw new Error(`S3 PUT ${key} failed: ${response.status} ${await safeText(response)}`);
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`S3 GET ${key} failed: ${response.status} ${await safeText(response)}`);
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key);
    // 204 is the success case; 404 means it is already gone, which is the
    // state the caller asked for.
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE ${key} failed: ${response.status} ${await safeText(response)}`);
    }
  }

  private async send(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { url, host, path } = this.addressOf(key);
    const signed = signV4({
      method,
      path,
      host,
      region: this.config.region,
      service: 's3',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      payload: body ?? Buffer.alloc(0),
      extraHeaders,
      now: new Date(),
    });
    return fetch(url, {
      method,
      headers: signed,
      ...(body ? { body: new Uint8Array(body) } : {}),
    });
  }

  private addressOf(key: string): { url: string; host: string; path: string } {
    const base = new URL(this.config.endpoint);
    const encodedKey = key.split('/').map(encodeRfc3986).join('/');
    if (this.config.forcePathStyle) {
      const path = `/${encodeRfc3986(this.config.bucket)}/${encodedKey}`;
      return { url: `${base.origin}${path}`, host: base.host, path };
    }
    const host = `${this.config.bucket}.${base.host}`;
    const path = `/${encodedKey}`;
    return { url: `${base.protocol}//${host}${path}`, host, path };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

/**
 * RFC 3986 encoding, which is what SigV4's canonical URI requires and what
 * `encodeURIComponent` almost — but not quite — produces. The four characters
 * below are "unreserved" to `encodeURIComponent` and reserved to RFC 3986; a
 * key containing one of them would sign correctly and then 403, which is a
 * miserable thing to debug.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface SignV4Params {
  method: string;
  /** Already-encoded canonical path, beginning with `/`. */
  path: string;
  host: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: Buffer;
  extraHeaders?: Record<string, string>;
  now: Date;
}

/**
 * AWS Signature Version 4, the header-based flavour, for a request with no
 * query string.
 *
 * Exported so it can be unit-tested on its own — the canonical request and
 * the string to sign are the two places this goes wrong, and both are pure
 * functions of the inputs. See `s3-media-storage.spec.ts`.
 */
export function signV4(params: SignV4Params): Record<string, string> {
  const amzDate = params.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(params.payload).digest('hex');

  const headers: Record<string, string> = {
    host: params.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(
      Object.entries(params.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    params.method,
    params.path,
    '', // no query string: this driver addresses objects by path only
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signature = createHmac('sha256', signingKey(params.secretAccessKey, dateStamp, params.region, params.service))
    .update(stringToSign)
    .digest('hex');

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** The four-round derivation from AWS's own signing documentation. */
function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}
