// Armenian visual motifs, drawn as light line art so they stay decorative:
// Ararat (Masis and Sis, the two peaks seen from Yerevan), a braided band
// in the spirit of khachkar stone carving, and a small pomegranate mark.
// All are aria-hidden: they carry no content.

/** Ararat at dusk: big Masis on the left, conical Sis on the right. */
export function Ararat({ className = "", tone = "light", id = "ararat" }: { className?: string; tone?: "light" | "night"; id?: string }) {
  const night = tone === "night";
  return (
    <svg viewBox="0 0 1200 360" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-masis`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? "#3a2f3a" : "#e9d3c3"} />
          <stop offset="1" stopColor={night ? "#1f1a21" : "#f3e6db"} />
        </linearGradient>
        <linearGradient id={`${id}-sis`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? "#332a34" : "#e4c9b6"} />
          <stop offset="1" stopColor={night ? "#1d181f" : "#f2e3d7"} />
        </linearGradient>
      </defs>
      {/* Sis (Little Ararat) */}
      <path d="M700 360 L905 150 Q915 140 925 150 L1200 330 L1200 360 Z" fill={`url(#${id}-sis)`} />
      {/* Masis (Great Ararat) */}
      <path
        d="M0 360 L0 330 C120 300 250 220 380 120 C420 90 450 60 480 52 C500 47 515 50 530 58 C590 90 640 150 720 210 C800 270 900 320 1000 360 Z"
        fill={`url(#${id}-masis)`}
      />
      {/* Snow caps */}
      <path
        d="M420 92 C445 70 465 55 480 52 C500 47 515 50 530 58 C555 72 580 95 600 118 L585 112 L566 124 L548 106 L530 122 L510 100 L490 118 L470 101 L448 116 Z"
        fill={night ? "#e9dcd0" : "#fffaf5"}
        opacity={night ? 0.85 : 1}
      />
      <path d="M893 162 L905 150 Q915 140 925 150 L938 160 L928 166 L918 158 L908 168 Z" fill={night ? "#e9dcd0" : "#fffaf5"} opacity={night ? 0.8 : 1} />
      {/* Gold ridge line */}
      <path
        d="M0 330 C120 300 250 220 380 120 C420 90 450 60 480 52 C500 47 515 50 530 58 C590 90 640 150 720 210 C800 270 900 320 1000 360"
        fill="none"
        stroke="#b08a57"
        strokeWidth="1.25"
        opacity={night ? 0.55 : 0.45}
      />
      <path d="M760 300 L905 150 Q915 140 925 150 L1200 330" fill="none" stroke="#b08a57" strokeWidth="1" opacity={night ? 0.45 : 0.35} />
    </svg>
  );
}

/** A braided band (two interlaced strands with knots), used as a divider. */
export function Braid({ className = "", id = "braid" }: { className?: string; id?: string }) {
  return (
    <svg className={className} height="14" width="100%" aria-hidden="true">
      <defs>
        <pattern id={id} width="28" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 7 C7 0 7 0 14 7 C21 14 21 14 28 7" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M0 7 C7 14 7 14 14 7 C21 0 21 0 28 7" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="14" cy="7" r="1.4" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#${id})`} />
    </svg>
  );
}

/** Eight-point rosette — a common khachkar motif — for small accents. */
export function Rosette({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
      <circle cx="12" cy="12" r="2.2" />
      {Array.from({ length: 8 }, (_, i) => (
        <ellipse key={i} cx="12" cy="6" rx="2.2" ry="4.4" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </svg>
  );
}

/** Pomegranate mark (Armenia's fruit symbol). */
export function Pomegranate({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M9 3.5 10.2 5.6 12 3.8 13.8 5.6 15 3.5 15.3 6.4A8 8 0 1 1 8.7 6.4Z" fill="currentColor" />
      <circle cx="10" cy="13" r="1" fill="#fff8f1" opacity=".7" />
      <circle cx="13.5" cy="12" r="1" fill="#fff8f1" opacity=".7" />
      <circle cx="12" cy="15.5" r="1" fill="#fff8f1" opacity=".7" />
    </svg>
  );
}

/** Armenian letters used as numerals: Ա=1 … Թ=9. */
export const ARM_NUMERALS = ["Ա", "Բ", "Գ", "Դ", "Ե", "Զ", "Է", "Ը", "Թ"] as const;
