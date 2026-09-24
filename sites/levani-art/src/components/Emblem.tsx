import type { EmblemId } from '@/i18n/config';

/**
 * Heraldic language emblems.
 *
 * One drawing system for all six: the same heater shield, the same thin
 * bronze rim, muted heraldic tinctures, and charges simplified until they
 * read at 20 px. These are stylised renderings for a language control, not
 * official reproductions of state arms — see CONTENT_TODO.md for the note on
 * using state and royal arms.
 */

const T = {
  gules: '#8a2a24',
  azure: '#1f3764',
  or: '#c9a45c',
  orDeep: '#a9843f',
  argent: '#ece5d8',
  vert: '#2d4f3a',
  sable: '#141210',
  tenne: '#c77a2c',
  rim: '#b08d57',
} as const;

const SHIELD = 'M3 3h34v19.5C37 34 29.5 40.5 20 45 10.5 40.5 3 34 3 22.5Z';

/**
 * Shared clip path and sheen, rendered once per page (in the root layout) so
 * that emblems repeated in the header, menu and footer do not duplicate ids.
 * Not display:none — Chromium drops gradients defined inside hidden SVGs.
 */
export function EmblemDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="emb-shield" clipPathUnits="userSpaceOnUse">
          <path d={SHIELD} />
        </clipPath>
        <linearGradient id="emb-sheen" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Shield({ children }: { children: React.ReactNode }) {
  return (
    <>
      <g clipPath="url(#emb-shield)">
        {children}
        <rect width="40" height="48" fill="url(#emb-sheen)" />
      </g>
      <path d={SHIELD} fill="none" stroke={T.rim} strokeWidth="1.6" />
    </>
  );
}

/** Single-headed heraldic eagle, head to dexter (viewer's left). */
function Eagle({ body, accent }: { body: string; accent: string }) {
  return (
    <g>
      {/* wings */}
      <path
        d="M17.6 18.5 8 11.5l.6 4.2-2.1.3 1.6 3-2 .8 2.2 2.6-1.4 1.4 3.2 1.4 1 2.4 8.3-3.3Z"
        fill={body}
      />
      <path
        d="M22.4 18.5 32 11.5l-.6 4.2 2.1.3-1.6 3 2 .8-2.2 2.6 1.4 1.4-3.2 1.4-1 2.4-8.3-3.3Z"
        fill={body}
      />
      {/* body, head, tail */}
      <ellipse cx="20" cy="24" rx="3.6" ry="7.2" fill={body} />
      <circle cx="19.2" cy="14.6" r="2.7" fill={body} />
      <path d="M17 14.3l-2.4.9 2.3.8Z" fill={accent} />
      <path d="M17.4 30l-3 7.2 3.4-1.7 2.2 3 2.2-3 3.4 1.7-3-7.2Z" fill={body} />
      {/* legs */}
      <path d="M16.9 29.4l-3.6 3.4M23.1 29.4l3.6 3.4" stroke={accent} strokeWidth="1.3" strokeLinecap="round" />
    </g>
  );
}

function DoubleEagle({ body, accent }: { body: string; accent: string }) {
  return (
    <g>
      <path d="M17.6 19.5 7.5 11l.5 4.4-2.2.2 1.7 3.1-2.1.8 2.3 2.7-1.4 1.4 3.3 1.4 1 2.5 8.6-3.4Z" fill={body} />
      <path d="M22.4 19.5 32.5 11l-.5 4.4 2.2.2-1.7 3.1 2.1.8-2.3 2.7 1.4 1.4-3.3 1.4-1 2.5-8.6-3.4Z" fill={body} />
      <ellipse cx="20" cy="25" rx="3.7" ry="7" fill={body} />
      {/* two necks and heads */}
      <path d="M18.6 19.5c-1.2-2-2-3.6-2-5.2M21.4 19.5c1.2-2 2-3.6 2-5.2" stroke={body} strokeWidth="2.2" fill="none" />
      <circle cx="16.3" cy="13.2" r="2.2" fill={body} />
      <circle cx="23.7" cy="13.2" r="2.2" fill={body} />
      <path d="M14.4 13l-2 .7 2 .7ZM25.6 13l2 .7-2 .7Z" fill={accent} />
      {/* crowns */}
      <path d="M15 10.6h2.6l-.4-1.6-.9.8-.9-.8Z M22.4 10.6H25l-.4-1.6-.9.8-.9-.8Z" fill={body} />
      <path d="M18.4 9.4h3.2l-.5-2-1.1 1-1.1-1Z" fill={body} />
      <path d="M17.5 30.5l-2.6 6.6 3.2-1.6 1.9 2.8 1.9-2.8 3.2 1.6-2.6-6.6Z" fill={body} />
      {/* central escutcheon */}
      <path d="M18 22.5h4v3.2c0 1.6-1 2.6-2 3.1-1-.5-2-1.5-2-3.1Z" fill={accent} stroke={body} strokeWidth="0.5" />
    </g>
  );
}

function Fleur({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
      <path d="M0-5.2C1.3-3.4 1.6-1.6 0 .6-1.6-1.6-1.3-3.4 0-5.2Z" />
      <path d="M-.5.2C-2-1.8-4.4-1.6-4.3.4c.1 1.4 1.7 1.6 2.3.6-.9.2-1.2-.6-.6-1 .6-.4 1.5.2 1.9 1Z" />
      <path d="M.5.2C2-1.8 4.4-1.6 4.3.4 4.2 1.8 2.6 2 2 1c.9.2 1.2-.6.6-1-.6-.4-1.5.2-1.9 1Z" />
      <rect x="-2.4" y="1" width="4.8" height="1" rx="0.3" />
      <path d="M-.8 2.1 0 4.8.8 2.1Z" />
    </g>
  );
}

function Lion({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) {
  // Lion passant guardant, reduced to a silhouette that still reads at 8 px:
  // body, maned head facing out, four legs, tail raised over the back.
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
      <rect x="-4" y="-1.3" width="7" height="2.5" rx="1.2" />
      <circle cx="3.6" cy="-1.5" r="1.9" />
      <path d="M-3.7 .6h.9v2.6h-.9ZM-2.3.6h.9v2.4h-.9ZM1 .6h.9v2.4H1ZM2.4.6h.9v2.6h-.9Z" />
      <path d="M-3.8-.6c-1.4-.4-1.9-1.8-1.3-3 .3.9.8 1.4 1.7 1.6Z" />
      <circle cx="-5.2" cy="-3.8" r=".7" />
    </g>
  );
}

function Rampant({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      fill={fill}
      d="M-.6-5.6c1.2-.6 2.6.2 2.6 1.6 0 .6-.3 1-.7 1.3l1.9 1.2-.6.5-1.7-.7.2 1.8 1.6 1.7-.7.5L.4 1v2.5l1.6 1.8H.8L-.8 3.6l-1.8 1.7h-1.1l2-2.4.1-2.8c-.9-.6-1.3-1.7-1-2.8l-1.7-.7.4-.6 1.8.4c.2-.9.5-1.6 1.5-2Z"
    />
  );
}

function Harp({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} stroke={fill} fill="none" strokeLinecap="round">
      <path d="M-3.2 4.6V-3.2c1.6-2 4.4-2 6.2-.6L-3.2 4.6" strokeWidth="1.2" />
      <path d="M-1.8 2.9V-2.3M-.4 1.1v-3.9M1 -.7v-2.2" strokeWidth="0.55" />
    </g>
  );
}

function Mountain({ fill, snow }: { fill: string; snow: string }) {
  return (
    <g>
      <path d="M16.6 28.4l2.4-3.3 1.1 1.2 1.4-2 2.9 4.1Z" fill={fill} />
      <path d="M21.5 24.3l.8 1.1-.8-.2-.6.6-.3-.4Z" fill={snow} />
    </g>
  );
}

const draw: Record<EmblemId, () => React.ReactNode> = {
  AM: () => (
    <Shield>
      <rect x="0" y="0" width="20" height="24" fill={T.gules} />
      <rect x="20" y="0" width="20" height="24" fill={T.azure} />
      <rect x="0" y="24" width="20" height="24" fill={T.azure} />
      <rect x="20" y="24" width="20" height="24" fill={T.gules} />
      <Rampant x={10.5} y={12} s={0.95} fill={T.or} />
      <g transform="translate(30 11.5) scale(0.44) translate(-20 -24)">
        <Eagle body={T.or} accent={T.orDeep} />
      </g>
      <Rampant x={10.5} y={34.5} s={0.9} fill={T.or} />
      <Rampant x={29.5} y={34} s={0.85} fill={T.or} />
      {/* central escutcheon: Ararat on tenné */}
      <path d="M14.5 19h11v7.4c0 3.1-2.6 5.3-5.5 6.6-2.9-1.3-5.5-3.5-5.5-6.6Z" fill={T.tenne} stroke={T.or} strokeWidth="0.7" />
      <g transform="translate(-0.3 -1.2)">
        <Mountain fill={T.argent} snow="#fff" />
      </g>
    </Shield>
  ),
  RU: () => (
    <Shield>
      <rect width="40" height="48" fill={T.gules} />
      <DoubleEagle body={T.or} accent={T.gules} />
    </Shield>
  ),
  IT: () => (
    <Shield>
      <rect width="40" height="48" fill={T.vert} />
      {/* cogwheel */}
      <g transform="translate(20 22.5)">
        <circle r="9.4" fill="none" stroke="#9a9a92" strokeWidth="2.6" strokeDasharray="2.4 1.6" />
        <circle r="7.6" fill="none" stroke="#b9b8ae" strokeWidth="1.2" />
        <path
          d="M0-7.2 1.7-2.3 6.8-2.2 2.7.9 4.2 5.8 0 2.9-4.2 5.8-2.7.9-6.8-2.2-1.7-2.3Z"
          fill={T.argent}
          stroke={T.gules}
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </g>
      {/* olive and oak sprays */}
      <path d="M9 36c3.4 2.6 7 3.4 11 3.4M31 36c-3.4 2.6-7 3.4-11 3.4" stroke={T.or} strokeWidth="1" fill="none" />
      <path d="M11 36.4l-1.5-1.6M13.8 37.9l-1-2M16.8 38.8l-.5-2M29 36.4l1.5-1.6M26.2 37.9l1-2M23.2 38.8l.5-2" stroke={T.or} strokeWidth="1" strokeLinecap="round" />
    </Shield>
  ),
  DE: () => (
    <Shield>
      <rect width="40" height="48" fill={T.or} />
      <Eagle body={T.sable} accent="#b3322b" />
    </Shield>
  ),
  FR: () => (
    <Shield>
      <rect width="40" height="48" fill={T.azure} />
      <Fleur x={12.4} y={13.5} s={1.05} fill={T.or} />
      <Fleur x={27.6} y={13.5} s={1.05} fill={T.or} />
      <Fleur x={20} y={29} s={1.1} fill={T.or} />
    </Shield>
  ),
  GB: () => (
    <Shield>
      <rect x="0" y="0" width="20" height="24" fill={T.gules} />
      <rect x="20" y="0" width="20" height="24" fill={T.or} />
      <rect x="0" y="24" width="20" height="24" fill={T.azure} />
      <rect x="20" y="24" width="20" height="24" fill={T.gules} />
      <Lion x={11.4} y={7.2} s={0.8} fill={T.or} />
      <Lion x={11.4} y={12.6} s={0.8} fill={T.or} />
      <Lion x={11.4} y={18} s={0.8} fill={T.or} />
      <Rampant x={29.4} y={13} s={1.05} fill={T.gules} />
      <Harp x={11.4} y={33.2} s={1.05} fill={T.or} />
      <Lion x={28.6} y={29} s={0.72} fill={T.or} />
      <Lion x={28.6} y={33.6} s={0.72} fill={T.or} />
      <Lion x={28.6} y={38.2} s={0.72} fill={T.or} />
    </Shield>
  ),
};

export function Emblem({
  id,
  size = 22,
  title,
  className,
}: {
  id: EmblemId;
  size?: number;
  /** Omit when the emblem sits next to visible text (decorative). */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={Math.round((size * 48) / 40)}
      viewBox="0 0 40 48"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {draw[id]()}
    </svg>
  );
}
