'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import {
  enquiryReasons,
  HONEYPOT_FIELD,
  MIN_FILL_MS,
  normalizeEnquiry,
  STARTED_AT_FIELD,
  validateEnquiry,
  type EnquiryErrors,
  type EnquiryReason,
} from '@/lib/enquiry';

type Labels = Dictionary['enquiry'];
type State = 'idle' | 'sending' | 'sent';

export function EnquiryForm({
  locale,
  labels: t,
  artworks,
  endpoint,
}: {
  locale: Locale;
  labels: Labels;
  artworks: { slug: string; title: string }[];
  /** External URL that accepts the enquiry as a JSON POST. */
  endpoint: string;
}) {
  // The page is static, so the preselection is read in the browser.
  const params = useSearchParams();
  const slugParam = params.get('artwork') ?? '';
  const initialArtwork = artworks.some((a) => a.slug === slugParam) ? slugParam : '';
  const reasonParam = params.get('reason') ?? '';
  const initialReason = (enquiryReasons as readonly string[]).includes(reasonParam)
    ? (reasonParam as EnquiryReason)
    : '';
  const [state, setState] = useState<State>('idle');
  const [errors, setErrors] = useState<EnquiryErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  const markStarted = () => {
    if (!startedAt.current) startedAt.current = Date.now();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      ...Object.fromEntries(fd.entries()),
      consent: fd.get('consent') === 'on',
      locale,
    };
    const input = normalizeEnquiry(raw);
    const found = validateEnquiry(input);
    setErrors(found);
    setFormError(null);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    // No server of our own to filter bots, so the traps are checked here:
    // a filled honeypot or a sub-human fill time is dropped silently.
    const bot =
      String(fd.get(HONEYPOT_FIELD) ?? '').length > 0 ||
      Date.now() - (startedAt.current || Date.now()) < MIN_FILL_MS;
    if (bot) {
      setState('sent');
      return;
    }
    setState('sending');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ...input,
          [HONEYPOT_FIELD]: fd.get(HONEYPOT_FIELD) ?? '',
          [STARTED_AT_FIELD]: startedAt.current || Date.now(),
        }),
      });
      if (res.ok) {
        setState('sent');
        requestAnimationFrame(() => successRef.current?.focus());
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: EnquiryErrors };
      if (body.fields) setErrors(body.fields);
      setFormError(res.status === 429 ? t.errors.rateLimited : t.errors.generic);
    } catch {
      setFormError(t.errors.generic);
    }
    setState('idle');
  }

  if (state === 'sent') {
    return (
      <div className="enquiry-success" ref={successRef} tabIndex={-1} role="status">
        <span className="enquiry-success__mark" aria-hidden="true" />
        <h2 className="section-title">{t.successTitle}</h2>
        <p className="section-text">{t.successText}</p>
        <button type="button" className="text-link" onClick={() => setState('idle')}>
          {t.another}
        </button>
      </div>
    );
  }

  const err = (field: keyof EnquiryErrors) =>
    errors[field] ? (
      <span className="field__error" id={`${field}-error`}>
        {t.errors[errors[field]!]}
      </span>
    ) : null;
  const aria = (field: keyof EnquiryErrors) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` } : {};

  return (
    <form ref={formRef} className="enquiry" noValidate onSubmit={onSubmit} onFocus={markStarted}>
      <div className="field field--wide">
        <label htmlFor="artwork">{t.artwork}</label>
        <select id="artwork" name="artwork" defaultValue={initialArtwork} key={initialArtwork}>
          <option value="">{t.generalEnquiry}</option>
          {artworks.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.title}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field field--wide reasons">
        <legend>
          {t.reason} <span className="field__optional">({t.optional})</span>
        </legend>
        <div className="reasons__options">
          {enquiryReasons.map((r) => (
            <label key={r} className="reason">
              <input type="radio" name="reason" value={r} defaultChecked={initialReason === r} key={`${r}-${initialReason}`} />
              <span>{t.reasons[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="name">{t.name}</label>
        <input id="name" name="name" autoComplete="name" required maxLength={120} {...aria('name')} />
        {err('name')}
      </div>
      <div className="field">
        <label htmlFor="email">{t.email}</label>
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={200} {...aria('email')} />
        {err('email')}
      </div>
      <div className="field">
        <label htmlFor="phone">
          {t.phone} <span className="field__optional">({t.optional})</span>
        </label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} {...aria('phone')} />
        {err('phone')}
      </div>
      <div className="field">
        <label htmlFor="country">
          {t.country} <span className="field__optional">({t.optional})</span>
        </label>
        <input id="country" name="country" autoComplete="country-name" maxLength={80} {...aria('country')} />
        {err('country')}
      </div>
      <div className="field field--wide">
        <label htmlFor="message">{t.message}</label>
        <textarea id="message" name="message" rows={6} required maxLength={4000} {...aria('message')} />
        {err('message')}
      </div>

      {/* Honeypot: invisible to people, irresistible to form-filling bots. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor={HONEYPOT_FIELD}>Website</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
      </div>

      <div className="field field--wide">
        <label className="consent">
          <input type="checkbox" name="consent" {...aria('consent')} />
          <span>
            {t.consentBefore}
            <Link href={`/${locale}/privacy`}>{t.consentLink}</Link>
            {t.consentAfter}
          </span>
        </label>
        {err('consent')}
      </div>

      {formError ? (
        <p className="enquiry__error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="field field--wide">
        <button type="submit" className="button button--solid" disabled={state === 'sending'}>
          {state === 'sending' ? t.sending : t.submit}
        </button>
      </div>
    </form>
  );
}
