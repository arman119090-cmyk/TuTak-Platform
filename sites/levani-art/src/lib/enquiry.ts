/**
 * Enquiry payload: one validator shared by the form (instant feedback) and
 * the API route (the one that counts). Error values are dictionary keys, so
 * the client can show them in the visitor's language.
 */

export const enquiryReasons = ['purchase', 'viewing', 'delivery', 'trade'] as const;
export type EnquiryReason = (typeof enquiryReasons)[number];

export interface EnquiryInput {
  name: string;
  email: string;
  phone: string;
  country: string;
  message: string;
  reason: EnquiryReason | '';
  artwork: string;
  consent: boolean;
  locale: string;
}

export type EnquiryErrorKey = 'required' | 'email' | 'consent' | 'tooLong';
export type EnquiryErrors = Partial<Record<keyof EnquiryInput, EnquiryErrorKey>>;

export const limits = {
  name: 120,
  email: 200,
  phone: 40,
  country: 80,
  message: 4000,
  artwork: 120,
} as const;

// Deliberately permissive: one @, something on each side, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Normalises untrusted input into an EnquiryInput (never throws). */
export function normalizeEnquiry(raw: unknown): EnquiryInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = str(r.reason);
  return {
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    country: str(r.country),
    message: str(r.message),
    reason: (enquiryReasons as readonly string[]).includes(reason) ? (reason as EnquiryReason) : '',
    artwork: str(r.artwork),
    consent: r.consent === true,
    locale: str(r.locale),
  };
}

export function validateEnquiry(input: EnquiryInput): EnquiryErrors {
  const errors: EnquiryErrors = {};
  if (!input.name) errors.name = 'required';
  if (!input.email) errors.email = 'required';
  else if (!EMAIL.test(input.email)) errors.email = 'email';
  if (!input.message) errors.message = 'required';
  if (!input.consent) errors.consent = 'consent';
  for (const [field, max] of Object.entries(limits) as [keyof typeof limits, number][]) {
    if (input[field].length > max) errors[field] = 'tooLong';
  }
  return errors;
}

/** Anti-spam fields. Named blandly so autofill and bots both fill the trap. */
export const HONEYPOT_FIELD = 'website';
export const STARTED_AT_FIELD = 'startedAt';
/** A human does not complete the form in under this many milliseconds. */
export const MIN_FILL_MS = 2500;
