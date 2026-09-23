// Text wordmark for the store. Deliberately NOT the manufacturer's logo:
// the official logo is only used once brand assets are supplied and
// authorised (docs/ASSETS.md).
export function Wordmark() {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[1.15rem] font-extrabold tracking-[-0.04em]">Little Joe</span>
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted">Armenia</span>
    </span>
  );
}
