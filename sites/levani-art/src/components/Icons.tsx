const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

export const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

export const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
);

/** The small caret beside the language emblem. */
export const Chevron = ({ size = 8 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" {...base} strokeWidth={1.3}>
    <path d="M2 3.8 5 6.6 8 3.8" />
  </svg>
);

export const ArrowRight = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 12h15M14 7l5 5-5 5" />
  </svg>
);

export const ArrowLeft = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M20 12H5M10 7l-5 5 5 5" />
  </svg>
);
