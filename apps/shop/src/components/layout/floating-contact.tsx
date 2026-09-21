'use client';

import { useState } from 'react';
import { MessageCircle, Phone, Send, X } from 'lucide-react';
import { brand } from '@/config/brand';
import type { Dictionary, Locale } from '@/lib/i18n';
import { CallbackDialog } from '@/components/forms/request-dialog';

/**
 * The floating "talk to us" bubble every furniture shop has. The messengers are
 * real deep links; the callback form writes a request row the admin can see.
 */
export const FloatingContact = ({ locale, dict }: { locale: Locale; dict: Dictionary }) => {
  const [open, setOpen] = useState(false);
  const [callback, setCallback] = useState(false);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
        {open ? (
          <div className="fade-in flex flex-col gap-2">
            <a
              href={`https://wa.me/${brand.contacts.whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-4 text-[13px] font-medium text-white shadow-[var(--shadow-card)]"
            >
              <MessageCircle width={18} height={18} /> WhatsApp
            </a>
            <a
              href={`https://t.me/${brand.contacts.telegram}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex h-11 items-center gap-2 rounded-full bg-[#2AABEE] px-4 text-[13px] font-medium text-white shadow-[var(--shadow-card)]"
            >
              <Send width={18} height={18} /> Telegram
            </a>
            <button
              type="button"
              onClick={() => {
                setCallback(true);
                setOpen(false);
              }}
              className="flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-[13px] font-medium shadow-[var(--shadow-card)]"
            >
              <Phone width={18} height={18} /> {dict.nav.callback}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={dict.forms.callbackTitle}
          className="flex h-13 w-13 min-h-[52px] min-w-[52px] items-center justify-center rounded-full bg-ink text-white shadow-[var(--shadow-pop)]"
        >
          {open ? <X width={22} height={22} /> : <MessageCircle width={22} height={22} />}
        </button>
      </div>
      {callback ? (
        <CallbackDialog locale={locale} dict={dict} onClose={() => setCallback(false)} />
      ) : null}
    </>
  );
};
