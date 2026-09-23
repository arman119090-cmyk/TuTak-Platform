// Store wordmark set in a playful display face. It is NOT the
// manufacturer's registered logo artwork; the official logo file can be
// swapped in here once brand assets are supplied (docs/ASSETS.md).
export function Wordmark({ tagline, light }: { tagline?: string; light?: boolean }) {
  return (
    <span className="flex flex-col leading-none">
      <span className={`font-[family-name:var(--font-logo)] text-[1.7rem] tracking-[0.01em] ${light ? "text-white" : "text-ink"}`}>Little Joe</span>
      {tagline ? <span className={`mt-0.5 text-[0.62rem] font-semibold ${light ? "text-white/60" : "text-ink-2"}`}>{tagline}</span> : null}
    </span>
  );
}
