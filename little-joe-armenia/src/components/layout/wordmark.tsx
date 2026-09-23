// Store wordmark set in a rounded display face close to the brand's
// lettering. It is NOT the manufacturer's registered logo artwork; the
// official logo file can be swapped in here once supplied (docs/ASSETS.md).
export function Wordmark({ tagline, light }: { tagline?: string; light?: boolean }) {
  return (
    <span className="flex flex-col leading-none">
      <span className={`font-[family-name:var(--font-logo)] text-[1.7rem] tracking-[0.01em] md:text-[1.85rem] ${light ? "text-white" : "text-ink"}`}>
        Little Joe<sup className="ml-0.5 align-super font-sans text-[0.5rem] font-bold">®</sup>
      </span>
      {tagline ? (
        <span className={`mt-0.5 text-[0.56rem] font-bold uppercase tracking-[0.28em] ${light ? "text-white/55" : "text-brand"}`}>{tagline}</span>
      ) : null}
    </span>
  );
}
