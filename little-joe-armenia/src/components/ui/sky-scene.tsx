// Decorative Armenian sky: gradient, soft clouds and the two peaks of
// Mount Ararat (Masis and Sis). Pure SVG so it is crisp at any size, weighs
// a few hundred bytes and never shifts layout. Always aria-hidden.

type Props = {
  className?: string;
  /** Show the mountains (hero / banners) or only sky and clouds (cards). */
  mountains?: boolean;
  /** Where the horizon sits, 0–1 of the height. */
  horizon?: number;
  id?: string;
};

function Cloud({ x, y, s, o = 1 }: { x: number; y: number; s: number; o?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      <ellipse cx="0" cy="0" rx="60" ry="22" />
      <ellipse cx="-38" cy="6" rx="36" ry="18" />
      <ellipse cx="40" cy="8" rx="42" ry="17" />
      <ellipse cx="-4" cy="-14" rx="34" ry="22" />
      <ellipse cx="26" cy="-8" rx="26" ry="17" />
    </g>
  );
}

export function SkyScene({ className = "", mountains = true, horizon = 0.72, id = "sky" }: Props) {
  const h = 600;
  const base = Math.round(h * horizon);
  return (
    <svg className={className} viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bcdcf7" />
          <stop offset="0.55" stopColor="#dcecfb" />
          <stop offset="1" stopColor="#f5f9fe" />
        </linearGradient>
        <linearGradient id={`${id}-mt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fb3cc" />
          <stop offset="1" stopColor="#c9d7e8" />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5f9fe" stopOpacity="0" />
          <stop offset="1" stopColor="#f5f9fe" stopOpacity="1" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <rect width="1200" height="600" fill={`url(#${id}-bg)`} />
      <g fill="#ffffff" filter={`url(#${id}-soft)`}>
        <Cloud x={170} y={90} s={1.2} o={0.9} />
        <Cloud x={560} y={60} s={0.8} o={0.75} />
        <Cloud x={960} y={120} s={1.1} o={0.85} />
        <Cloud x={1130} y={40} s={0.7} o={0.7} />
      </g>
      {mountains ? (
        <g>
          {/* Sis (small Ararat) */}
          <path d={`M600 ${base} L790 ${base - 150} L990 ${base} Z`} fill={`url(#${id}-mt)`} opacity="0.85" />
          <path d={`M760 ${base - 124} L790 ${base - 150} L822 ${base - 122} L806 ${base - 116} L792 ${base - 128} L776 ${base - 114} Z`} fill="#ffffff" opacity="0.95" />
          {/* Masis (great Ararat) */}
          <path d={`M180 ${base} L470 ${base - 255} Q520 ${base - 290} 575 ${base - 250} L880 ${base} Z`} fill={`url(#${id}-mt)`} />
          <path
            d={`M405 ${base - 198} L470 ${base - 255} Q520 ${base - 290} 575 ${base - 250} L640 ${base - 195} L612 ${base - 186} L586 ${base - 206} L560 ${base - 180} L530 ${base - 210} L500 ${base - 182} L470 ${base - 214} L440 ${base - 184} Z`}
            fill="#ffffff"
          />
        </g>
      ) : null}
      <g fill="#ffffff" filter={`url(#${id}-soft)`}>
        <Cloud x={80} y={base + 20} s={1.6} o={0.95} />
        <Cloud x={420} y={base + 40} s={1.9} o={0.9} />
        <Cloud x={820} y={base + 30} s={1.7} o={0.95} />
        <Cloud x={1150} y={base + 20} s={1.5} o={0.9} />
      </g>
      <rect y={base - 20} width="1200" height={h - base + 20} fill={`url(#${id}-fade)`} />
    </svg>
  );
}
