'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button, Input } from '@/components/ui';

export const NewsletterForm = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('loading');
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      setState(response.ok ? 'done' : 'error');
      if (response.ok) setEmail('');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <p className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-success-soft px-3 py-2.5 text-[13px] text-success">
        <Check width={16} height={16} /> {dict.home.newsletterOk}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={dict.home.emailPlaceholder}
        aria-label={dict.home.emailPlaceholder}
        className="flex-1"
      />
      <Button type="submit" disabled={state === 'loading'}>
        {state === 'loading' ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
        {dict.home.newsletterCta}
      </Button>
      {state === 'error' ? <span className="text-[12px] text-sale">{dict.forms.errorText}</span> : null}
    </form>
  );
};
