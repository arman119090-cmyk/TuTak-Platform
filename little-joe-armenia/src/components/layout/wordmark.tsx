// Store wordmark set in the display serif. It is NOT the manufacturer's
// registered logo artwork; the official logo file can be swapped in here
// once brand assets are supplied (docs/ASSETS.md).
export function Wordmark({ tagline, light }: { tagline?: string; light?: boolean }) {
  return (
    <span className="flex flex-col leading-none">
      <span className={`font-[family-name:var(--font-serif)] text-[1.55rem] font-semibold italic tracking-[-0.01em] md:text-[1.7rem] ${light ? "text-white" : "text-brand"}`}>
        Little Joe
      </span>
      <span className={`mt-1 flex items-center gap-1.5 text-[0.56rem] font-semibold uppercase tracking-[0.32em] ${light ? "text-[#ffffff]/55" : "text-muted"}`}>
        <span className="inline-block size-1 rounded-full bg-[var(--color-azure)]" aria-hidden="true" />
        {tagline ?? "Armenia"}
      </span>
    </span>
  );
}
