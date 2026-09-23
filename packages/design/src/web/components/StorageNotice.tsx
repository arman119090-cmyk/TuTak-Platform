'use client';

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'tutak-storage-notice-ack';

/**
 * What this dashboard keeps in the browser, said plainly once.
 *
 * ## Why this is a notice and not a consent banner
 *
 * The dashboards store two things: a device identifier, which binds a session
 * to the browser it was issued to and is what makes "sign out everywhere"
 * meaningful, and the chosen theme. Both are *strictly necessary* for a
 * service the person explicitly asked for by signing in — the ePrivacy
 * exemption that consent rules are written around. Neither is analytics,
 * neither is advertising, and neither follows anybody anywhere.
 *
 * Asking consent for storage that does not need it is not extra safety. It
 * trains people to dismiss consent dialogs without reading them, so the one
 * that eventually matters — the analytics opt-in, when analytics exists — is
 * the one they click through fastest. So this informs, which is what the law
 * actually requires here, and does not pretend to offer a choice that has no
 * effect.
 *
 * **When analytics arrives, this component is not what changes.** A real
 * opt-in gate belongs where the SDK loads, defaulting to off, and this notice
 * then gains a line pointing at it. Turning this into a fake consent dialog
 * in the meantime would be the worst of both.
 *
 * The acknowledgement itself is stored under the same exemption: remembering
 * that somebody has read a notice is part of showing it correctly.
 */
/**
 * The copy, so an app that speaks more than one language can supply it.
 *
 * Defaults in English because the admin panel is English-only and passing
 * five strings to keep that unchanged would be noise. The partner panel
 * passes its own: a Russian screen with one English paragraph pinned to the
 * bottom of it is the kind of thing that makes a whole translation look
 * unfinished.
 */
export interface StorageNoticeCopy {
  regionLabel: string;
  body: string;
  privacyLink: string;
  acknowledge: string;
}

const DEFAULT_COPY: StorageNoticeCopy = {
  regionLabel: 'How this dashboard uses browser storage',
  body:
    'This dashboard keeps two things in your browser: an identifier for this device, so your ' +
    'session can be tied to it and signed out separately, and your chosen theme. Nothing here ' +
    'tracks you or is shared with anyone.',
  privacyLink: 'Privacy policy',
  acknowledge: 'Got it',
};

export function StorageNotice({
  privacyUrl,
  copy = DEFAULT_COPY,
}: {
  privacyUrl?: string;
  copy?: StorageNoticeCopy;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Read after mount, never during render: the server has no localStorage,
    // and reading it in render makes the first client paint disagree with the
    // server's HTML.
    try {
      if (window.localStorage.getItem(DISMISSED_KEY) !== '1') setVisible(true);
    } catch {
      // Private mode, or storage disabled. The notice is not important enough
      // to break a page over, and a person who has disabled storage is not
      // the person this needs to reach.
    }
  }, []);

  if (!visible) return null;

  const acknowledge = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Same reasoning: it will simply be shown again next time.
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={copy.regionLabel}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-subtle bg-surface px-4 py-3 text-[13px] shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-secondary">
          {copy.body}{' '}
          {privacyUrl ? (
            <a className="underline" href={privacyUrl} target="_blank" rel="noreferrer">
              {copy.privacyLink}
            </a>
          ) : null}
        </p>
        <button
          type="button"
          onClick={acknowledge}
          className="shrink-0 rounded-md border border-subtle px-3 py-1.5 font-medium"
        >
          {copy.acknowledge}
        </button>
      </div>
    </div>
  );
}
