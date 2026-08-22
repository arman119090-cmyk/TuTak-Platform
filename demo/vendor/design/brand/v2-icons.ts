/**
 * The v2 Jako-derived icon family — bottom navigation, the referral-network
 * entry, and the small CTA wing signature.
 *
 * Source: `docs/design/assets/v2/icons/*.svg` on
 * `design/tutak-mobile-v2-handoff` (TUTAK_V2_CLAUDE_TASK.md, "individually
 * exported vector button and bottom-navigation sources"). Paths are copied
 * byte-for-byte from those source SVGs — do not redraw or approximate them
 * from memory; if the design source changes, re-copy from there.
 *
 * Every icon is `currentColor` outline art on a 48×48 canvas (the wing mark
 * alone is 24×24, matching its source). A caller supplies colour via the
 * rendering component's `color` prop, never by editing a path here. Per
 * `TUTAK_V2_UI_ASSET_MANIFEST.md` and the master spec's Jako-icon-boundary
 * table: every icon still carries a real accessible name at the point it is
 * rendered — the pictogram is reinforcement, never the only way to identify
 * the control, and none of these belong on a danger/rejection/disabled
 * control (see `jako-wing-mark`'s own docblock below).
 */

export const V2_NAV_ICON_VIEWBOX = '0 0 48 48';

/** One stroked (or filled) sub-path of a v2 icon. `fill` defaults to 'none'. */
export interface V2IconStroke {
  d: string;
  strokeWidth?: number;
  fill?: 'none' | 'currentColor';
}

export type V2NavIconName = 'home' | 'map' | 'qr' | 'wallet' | 'profile' | 'referralNetwork';

/**
 * `nav-home.svg` — "an open nest/perch and feather roof... never a cage".
 */
const home: V2IconStroke[] = [
  { d: 'M12 25c3-6 7-10 12-13 5 3 9 7 12 13M16 23v14h16V23M12 37h24', strokeWidth: 2.7 },
  { d: 'M20 17c2 1 4 2 6 5M17 22c3 .5 5 2 7 5', strokeWidth: 2.1 },
];

/** `nav-map.svg` — "flight route inside/along the location pin". */
const map: V2IconStroke[] = [
  { d: 'M24 13c-6 0-10 4-10 10 0 8 10 16 10 16s10-8 10-16c0-6-4-10-10-10z', strokeWidth: 2.7 },
  { d: 'M20 22c2-3 5-3 7 0-2 3-5 3-7 0z', strokeWidth: 2 },
  { d: 'M10 15c2-3 5-4 8-4', strokeWidth: 2 },
];

/** `nav-qr.svg` — "scan corners framing Jako's eye". */
const qr: V2IconStroke[] = [
  {
    d: 'M18 12h-4a3 3 0 0 0-3 3v4M30 12h4a3 3 0 0 1 3 3v4M18 36h-4a3 3 0 0 1-3-3v-4M30 36h4a3 3 0 0 0 3-3v-4',
    strokeWidth: 2.7,
  },
  { d: 'M18 24c2.4-4 9.6-4 12 0-2.4 4-9.6 4-12 0z', strokeWidth: 2.3 },
];
// The source SVG's centre dot is a `<circle>`, not a path — drawn separately
// by the rendering component via `v2QrIconDot` below, not folded in here.

/** `nav-wallet.svg` — "folded wing/feather lines". */
const wallet: V2IconStroke[] = [
  {
    d: 'M12 17h21a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V20a3 3 0 0 1 3-3h5',
    strokeWidth: 2.7,
  },
  { d: 'M29 25h9v7h-9a3.5 3.5 0 0 1 0-7zM16 19c3 1 5 3 6 6M15 24c3 1 5 3 6 6', strokeWidth: 2.1 },
];

/** `nav-profile.svg` — "minimal parrot head/eye plus human-profile body". */
const profile: V2IconStroke[] = [
  { d: 'M20 14c4-2 9 1 9 6 0 4-3 7-7 7-4 0-7-3-7-7 0-3 2-5 5-6z', strokeWidth: 2.7 },
  { d: 'M19 14c1-3 4-5 7-5M14 37c1.5-7 5.5-11 11-11s9.5 4 11 11', strokeWidth: 2.7 },
];

/** `referral-network.svg` — "branch with three feather nodes". */
const referralNetwork: V2IconStroke[] = [
  { d: 'M13 34c5-2 8-7 10-14M24 20c3 1 7 5 11 14M16 28c3 1 6 3 8 6', strokeWidth: 2.6 },
  {
    d: 'M11 34c3-5 7-5 9 0-3 3-6 3-9 0zM20 18c3-5 7-5 9 0-3 3-6 3-9 0zM29 34c3-5 7-5 9 0-3 3-6 3-9 0z',
    strokeWidth: 2.3,
  },
];

export const v2NavIconPaths: Record<V2NavIconName, V2IconStroke[]> = {
  home,
  map,
  qr,
  wallet,
  profile,
  referralNetwork,
};

/** `nav-qr.svg`'s centre dot — a filled circle, not a path, in the source. */
export const v2QrIconDot = { cx: 24, cy: 24, r: 2.6 } as const;

export const V2_WING_MARK_VIEWBOX = '0 0 24 24';

/**
 * `jako-wing-mark.svg` — the small CTA signature. Per the master spec's
 * Jako-icon-boundary table and `TUTAK_V2_COMPONENT_INVENTORY.md`'s "Jako
 * icon boundary" section: usable only on a safe primary/secondary action,
 * the Home/referral entry, and the branded navigation. Never on `Отклонить`,
 * any error/rejection/destructive control, a disabled control, or a dense
 * operational control (partner/admin confirm-reject rows, cashier amount
 * entry). It is a signature next to a localized label, never a replacement
 * for one.
 */
export const jakoWingMarkStrokes: V2IconStroke[] = [
  { d: 'M5 18c2-8 6-12 14-13-1 8-5 13-12 14', strokeWidth: 2.3 },
  { d: 'M8 16c3-1 5-3 8-7M11 18c2-1 4-2 6-5', strokeWidth: 1.8 },
];
