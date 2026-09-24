'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { fill, formatCount, type Plural } from '@/i18n/plural';
import { searchEntries, type SearchEntry } from '@/lib/search';
import { CloseIcon } from './Icons';

export interface SearchLabels {
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  noResults: string;
  results: Plural;
  close: string;
}

export function SearchOverlay({
  locale,
  open,
  onClose,
  entries,
  labels,
}: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  entries: SearchEntry[];
  labels: SearchLabels;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const results = searchEntries(entries, deferred);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="overlay search"
      aria-labelledby="search-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="search__inner">
        <div className="search__top">
          <h2 id="search-title" className="eyebrow">
            {labels.title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={labels.close}>
            <CloseIcon size={22} />
          </button>
        </div>
        <label className="visually-hidden" htmlFor="site-search">
          {labels.label}
        </label>
        <input
          id="site-search"
          className="search__input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={labels.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="search__status" role="status" aria-live="polite">
          {deferred.trim()
            ? results.length
              ? formatCount(locale, results.length, labels.results)
              : fill(labels.noResults, { query: deferred.trim() })
            : labels.hint}
        </p>
        {results.length ? (
          <ol className="search__results">
            {results.map((r, i) => (
              <li key={r.slug}>
                <Link href={`/${locale}/artworks/${r.slug}`} className="search__row" onClick={onClose}>
                  <span className="search__index">{String(i + 1).padStart(2, '0')}</span>
                  <Image src={r.image} alt="" width={64} height={64} className="search__thumb" />
                  <span className="search__title">{r.title}</span>
                  <span className="search__meta">
                    {r.artist ? `${r.artist} · ` : ''}
                    {r.category}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </dialog>
  );
}
