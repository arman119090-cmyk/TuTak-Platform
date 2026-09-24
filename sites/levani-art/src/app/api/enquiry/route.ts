import { NextResponse } from 'next/server';
import { getArtwork } from '@/content/catalog';
import { deliverEnquiry, verifyCaptcha } from '@/lib/enquiry-transport';
import {
  HONEYPOT_FIELD,
  MIN_FILL_MS,
  normalizeEnquiry,
  STARTED_AT_FIELD,
  validateEnquiry,
} from '@/lib/enquiry';
import { createRateLimiter } from '@/lib/rate-limit';

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: Request) {
  const rate = limiter.hit(clientKey(req));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  if (Number(req.headers.get('content-length') ?? 0) > 20_000) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Bot signals get a quiet 200: telling a bot it was caught only teaches it.
  const honeypot = typeof raw[HONEYPOT_FIELD] === 'string' && (raw[HONEYPOT_FIELD] as string).length > 0;
  const startedAt = Number(raw[STARTED_AT_FIELD]);
  const tooFast = Number.isFinite(startedAt) && Date.now() - startedAt < MIN_FILL_MS;
  if (honeypot || tooFast) return NextResponse.json({ ok: true });

  if (!(await verifyCaptcha(typeof raw.captchaToken === 'string' ? raw.captchaToken : undefined))) {
    return NextResponse.json({ error: 'captcha' }, { status: 400 });
  }

  const input = normalizeEnquiry(raw);
  const fields = validateEnquiry(input);
  if (Object.keys(fields).length) {
    return NextResponse.json({ error: 'invalid', fields }, { status: 422 });
  }

  const artwork = input.artwork ? getArtwork(input.artwork) : undefined;
  const result = await deliverEnquiry({
    ...input,
    artwork: artwork ? artwork.slug : '',
    artworkTitle: artwork?.title ?? null,
    receivedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'not_configured' ? 503 : 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
