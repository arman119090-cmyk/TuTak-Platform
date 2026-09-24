import { enquiry } from '@/content/site';

/** Opens the owner's Instagram in a new tab — the enquiry channel for now. */
export function InstagramLink({
  children,
  className = 'button button--solid',
  newTabLabel,
}: {
  children: React.ReactNode;
  className?: string;
  /** Screen-reader hint, e.g. "opens in a new tab". */
  newTabLabel: string;
}) {
  return (
    <a href={enquiry.instagramUrl} target="_blank" rel="noopener noreferrer" className={className}>
      <InstagramGlyph />
      {children}
      <span className="visually-hidden"> ({newTabLabel})</span>
    </a>
  );
}

function InstagramGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="ig-glyph">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" />
    </svg>
  );
}
