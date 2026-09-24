import type { EnquiryInput } from './enquiry';

/**
 * Where an accepted enquiry goes. This is the single integration point for
 * email / CRM / messenger delivery — see README "Enquiries".
 *
 *  ENQUIRY_TRANSPORT=webhook  POST JSON to ENQUIRY_WEBHOOK_URL (Zapier, Make,
 *                             a CRM inbound hook, an email relay…)
 *  ENQUIRY_TRANSPORT=log      print to the server log — development only
 *  (unset)                    not configured: the API answers 503 and the
 *                             form tells the visitor, instead of pretending
 *                             an enquiry was delivered.
 */
export type DeliveryResult = { ok: true } | { ok: false; reason: 'not_configured' | 'failed' };

export interface EnquiryRecord extends EnquiryInput {
  receivedAt: string;
  artworkTitle: string | null;
}

export async function deliverEnquiry(record: EnquiryRecord): Promise<DeliveryResult> {
  const transport = process.env.ENQUIRY_TRANSPORT;

  if (transport === 'webhook') {
    const url = process.env.ENQUIRY_WEBHOOK_URL;
    if (!url) return { ok: false, reason: 'not_configured' };
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (process.env.ENQUIRY_WEBHOOK_SECRET) {
        headers.authorization = `Bearer ${process.env.ENQUIRY_WEBHOOK_SECRET}`;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true } : { ok: false, reason: 'failed' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  if (transport === 'log' && process.env.NODE_ENV !== 'production') {
    console.info('[enquiry]', JSON.stringify(record));
    return { ok: true };
  }

  return { ok: false, reason: 'not_configured' };
}

/**
 * Captcha hook. Returns true when no provider is configured. To add Cloudflare
 * Turnstile or hCaptcha: render the widget in EnquiryForm, send its token as
 * `captchaToken`, and verify it here against CAPTCHA_SECRET.
 */
export async function verifyCaptcha(_token: string | undefined): Promise<boolean> {
  if (!process.env.CAPTCHA_SECRET) return true;
  // Provider not chosen yet. Fail closed so a half-configured captcha is noticed.
  return false;
}
