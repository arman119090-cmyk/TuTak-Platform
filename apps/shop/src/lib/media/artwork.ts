import { createRng } from '@/lib/utils';
import { buildPalette, shift, type ArtPalette } from './palette';

/**
 * Deterministic catalogue artwork.
 *
 * The demo must not look like a shop with no photography, and it must not
 * depend on a third-party image host staying alive. So every product picture is
 * an SVG generated from the product's own colour, family and SKU: same input,
 * same picture, forever, with no network and no binary assets in git.
 *
 * Each product gets four "shots": a studio front view, an angled view, a close
 * detail and a styled room scene — the way a real catalogue photographs a piece.
 */

export const ART_WIDTH = 1200;
export const ART_HEIGHT = 900;

export type ArtVariant = 0 | 1 | 2 | 3;

export type ArtworkParams = {
  artKey: string;
  colorKey: string;
  variant: ArtVariant;
  /** Stable per-product number: nudges prop placement so shots differ. */
  seed: number;
};

type Ctx = ArtworkParams & { p: ArtPalette; rng: () => number };

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  rx = 0,
  extra = '',
): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, opacity = 1): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${opacity}"/>`;

/** Soft contact shadow so furniture sits on the floor instead of floating. */
const contactShadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${Math.max(10, rx * 0.09)}" fill="url(#shadow)"/>`;

const legs = (
  xs: number[],
  y: number,
  height: number,
  width: number,
  fill: string,
  splay = 0,
): string =>
  xs
    .map((x) =>
      splay === 0
        ? rect(x - width / 2, y, width, height, fill, width / 2)
        : `<path d="M${x - width / 2} ${y} L${x + width / 2} ${y} L${x + width / 2 + splay} ${y + height} L${x - width / 2 + splay} ${y + height} Z" fill="${fill}"/>`,
    )
    .join('');

// --------------------------------------------------------------- families ---

/** Sofas, armchairs, recliners: cushions, arms, back, plinth or legs. */
const upholstered = (
  ctx: Ctx,
  opts: {
    width: number;
    seats: number;
    corner?: 'left' | 'right' | null;
    armStyle?: 'round' | 'square' | 'low';
    backHeight?: number;
    legHeight?: number;
    recliner?: boolean;
  },
): string => {
  const { p } = ctx;
  const { width, seats } = opts;
  const armStyle = opts.armStyle ?? 'round';
  const backHeight = opts.backHeight ?? 210;
  const legHeight = opts.legHeight ?? 60;
  const baseY = 700 - legHeight;
  const left = 600 - width / 2;
  const seatTop = baseY - 150;
  const armWidth = armStyle === 'low' ? 60 : 88;
  const armTop = armStyle === 'low' ? seatTop - 40 : seatTop - 120;
  const radius = armStyle === 'square' ? 12 : 44;

  const cushionWidth = (width - armWidth * 2 - (seats - 1) * 10) / seats;
  const cushions = Array.from({ length: seats }, (_, index) => {
    const x = left + armWidth + index * (cushionWidth + 10);
    return [
      // back cushion
      rect(x, armTop - 10, cushionWidth, backHeight - 30, p.highlight, 26),
      rect(x + 6, armTop - 4, cushionWidth - 12, backHeight - 46, p.body, 22),
      // seat cushion
      rect(x, seatTop, cushionWidth, 74, p.body, 20),
      rect(x + 5, seatTop + 5, cushionWidth - 10, 60, p.highlight, 16, 'opacity="0.55"'),
    ].join('');
  }).join('');

  // Chaise module: shares the seat height and plinth of the main body so the
  // corner reads as one piece of furniture rather than a detached block.
  const chaiseWidth = 260;
  const chaiseX = opts.corner === 'right' ? left + width - 8 : left - chaiseWidth + 8;
  const cornerModule = opts.corner
    ? [
        // low back / side panel towards the wall
        rect(chaiseX, armTop + 46, chaiseWidth, baseY - armTop - 46, p.shade, 18),
        // seat cushion
        rect(chaiseX + 10, seatTop, chaiseWidth - 20, 74, p.body, 18),
        rect(chaiseX + 16, seatTop + 5, chaiseWidth - 32, 60, p.highlight, 14, 'opacity="0.55"'),
        // plinth continues the main base line
        rect(chaiseX, seatTop + 66, chaiseWidth, baseY - seatTop - 66, p.shade, 10),
        rect(chaiseX + 6, seatTop + 72, chaiseWidth - 12, 16, p.line, 4, 'opacity="0.25"'),
        // scatter cushion on the chaise
        rect(
          opts.corner === 'right' ? chaiseX + chaiseWidth - 110 : chaiseX + 26,
          seatTop - 66,
          84,
          74,
          p.highlight,
          16,
        ),
      ].join('')
    : '';

  const footrest = opts.recliner
    ? [
        rect(left + width * 0.18, baseY - 40, width * 0.64, 40, p.shade, 14),
        rect(left + width * 0.2, baseY - 34, width * 0.6, 26, p.body, 10),
      ].join('')
    : '';

  return [
    contactShadow(600, 712, width * 0.56),
    cornerModule,
    // back panel
    rect(left + armWidth - 8, armTop - 24, width - armWidth * 2 + 16, backHeight, p.shade, radius / 2),
    cushions,
    // arms
    rect(left, armTop, armWidth, baseY - armTop, p.shade, radius),
    rect(left + 8, armTop + 8, armWidth - 16, baseY - armTop - 16, p.body, radius * 0.8),
    rect(left + width - armWidth, armTop, armWidth, baseY - armTop, p.shade, radius),
    rect(left + width - armWidth + 8, armTop + 8, armWidth - 16, baseY - armTop - 16, p.body, radius * 0.8),
    // seat base
    rect(left, seatTop + 66, width, baseY - seatTop - 66, p.shade, 10),
    rect(left + 6, seatTop + 72, width - 12, 16, p.line, 4, 'opacity="0.25"'),
    footrest,
    legHeight > 0
      ? legs(
          opts.corner === 'right'
            ? [left + 46, left + width - 46, left + width + 200]
            : opts.corner === 'left'
              ? [left - 200, left + 46, left + width - 46]
              : [left + 46, left + width - 46, 600],
          baseY,
          legHeight,
          18,
          '#5A4632',
          8,
        )
      : '',
  ].join('');
};

/** Beds and mattresses. */
const bedFamily = (
  ctx: Ctx,
  opts: { width: number; headboard: 'upholstered' | 'wooden' | 'none'; mattressOnly?: boolean; kids?: boolean },
): string => {
  const { p } = ctx;
  const { width } = opts;
  const left = 600 - width / 2;
  const baseY = 690;

  if (opts.mattressOnly) {
    return [
      contactShadow(600, 706, width * 0.52),
      rect(left, baseY - 150, width, 150, shift(p.body, 0.55), 22, `stroke="${shift(p.shade, 0.25)}" stroke-width="3"`),
      rect(left, baseY - 150, width, 36, '#FFFFFF', 22, 'opacity="0.85"'),
      rect(left + 10, baseY - 108, width - 20, 8, p.shade, 4, 'opacity="0.3"'),
      rect(left + 10, baseY - 76, width - 20, 8, p.shade, 4, 'opacity="0.3"'),
      rect(left + 10, baseY - 44, width - 20, 8, p.shade, 4, 'opacity="0.3"'),
      // quilting dots
      Array.from({ length: 9 }, (_, i) =>
        ellipse(left + 40 + i * ((width - 80) / 8), baseY - 130, 5, 4, p.shade, 0.35),
      ).join(''),
      rect(left + 30, baseY - 6, width - 60, 6, p.line, 3, 'opacity="0.2"'),
    ].join('');
  }

  const headTop = opts.headboard === 'none' ? baseY - 190 : opts.headboard === 'wooden' ? 330 : 280;
  const headboard =
    opts.headboard === 'none'
      ? ''
      : opts.headboard === 'wooden'
        ? [
            rect(left - 10, headTop, width + 20, baseY - 120 - headTop, p.shade, 12),
            rect(left + 4, headTop + 14, width - 8, baseY - 150 - headTop, p.body, 8),
            rect(left + 30, headTop + 30, width - 60, baseY - 190 - headTop, p.highlight, 6, 'opacity="0.5"'),
          ].join('')
        : [
            rect(left - 14, headTop, width + 28, baseY - 130 - headTop, p.shade, 26),
            ...Array.from({ length: 4 }, (_, i) =>
              rect(
                left + 6 + i * ((width - 12) / 4),
                headTop + 12,
                (width - 12) / 4 - 12,
                baseY - 160 - headTop,
                p.body,
                18,
              ),
            ),
          ].join('');

  const pillows = [
    rect(left + 60, baseY - 210, width * 0.3, 70, '#FBF8F3', 24),
    rect(left + width - 60 - width * 0.3, baseY - 210, width * 0.3, 70, '#F4EFE7', 24),
  ].join('');

  return [
    contactShadow(600, 706, width * 0.55),
    headboard,
    // mattress + bedding
    rect(left, baseY - 150, width, 92, '#FCFAF6', 16),
    rect(left, baseY - 92, width, 40, shift(p.body, 0.35), 10),
    rect(left, baseY - 64, width, 22, p.body, 8),
    opts.kids ? rect(left + 20, baseY - 88, width - 40, 30, p.accent, 8, 'opacity="0.55"') : '',
    pillows,
    // frame
    rect(left - 12, baseY - 62, width + 24, 62, p.shade, 12),
    rect(left - 6, baseY - 52, width + 12, 14, p.line, 6, 'opacity="0.2"'),
    legs([left + 20, left + width - 20], baseY, 34, 20, '#5A4632'),
  ].join('');
};

/** Wardrobes, dressers, nightstands, shelving, TV units, kitchen cabinets. */
const caseFamily = (
  ctx: Ctx,
  opts: {
    width: number;
    height: number;
    doors?: number;
    drawers?: number;
    openShelves?: number;
    sliding?: boolean;
    mirrorDoor?: number | null;
    legHeight?: number;
    glassDoors?: boolean;
  },
): string => {
  const { p } = ctx;
  const legHeight = opts.legHeight ?? 40;
  const baseY = 720 - legHeight;
  const top = baseY - opts.height;
  const left = 600 - opts.width / 2;
  const parts: string[] = [
    contactShadow(600, 726, opts.width * 0.56),
    rect(left, top, opts.width, opts.height, p.shade, 8),
    rect(left + 8, top + 8, opts.width - 16, opts.height - 16, p.body, 5),
  ];

  const doors = opts.doors ?? 0;
  if (doors > 0) {
    const doorWidth = (opts.width - 24) / doors;
    for (let i = 0; i < doors; i += 1) {
      const x = left + 12 + i * doorWidth;
      const isMirror = opts.mirrorDoor === i;
      const fill = isMirror ? '#CBD5DA' : opts.glassDoors ? '#D6E0E3' : p.highlight;
      parts.push(rect(x + 3, top + 12, doorWidth - 6, opts.height - 24, fill, 4));
      if (isMirror || opts.glassDoors) {
        parts.push(
          `<path d="M${x + 12} ${top + opts.height - 40} L${x + doorWidth - 26} ${top + 26}" stroke="#FFFFFF" stroke-width="14" opacity="0.5" stroke-linecap="round"/>`,
        );
      }
      // handle
      parts.push(
        opts.sliding
          ? rect(x + doorWidth - 26, top + opts.height / 2 - 34, 8, 68, p.line, 4, 'opacity="0.7"')
          : rect(
              i % 2 === 0 ? x + doorWidth - 22 : x + 14,
              top + opts.height / 2 - 40,
              8,
              80,
              '#8C8C8C',
              4,
            ),
      );
    }
    if (opts.sliding) {
      parts.push(rect(left + 6, top + 6, opts.width - 12, 8, p.line, 4, 'opacity="0.35"'));
      parts.push(rect(left + 6, baseY - 14, opts.width - 12, 8, p.line, 4, 'opacity="0.35"'));
    }
  }

  const drawers = opts.drawers ?? 0;
  if (drawers > 0) {
    const zoneTop = doors > 0 ? baseY - 16 - drawers * 74 : top + 14;
    const drawerHeight = doors > 0 ? 70 : (opts.height - 28) / drawers;
    for (let i = 0; i < drawers; i += 1) {
      const y = zoneTop + i * (drawerHeight + 4);
      parts.push(rect(left + 14, y, opts.width - 28, drawerHeight - 6, p.highlight, 4));
      parts.push(rect(600 - 40, y + drawerHeight / 2 - 8, 80, 7, '#8C8C8C', 4));
    }
  }

  const shelves = opts.openShelves ?? 0;
  if (shelves > 0) {
    const zoneHeight = opts.height - 24;
    const shelfGap = zoneHeight / shelves;
    for (let i = 1; i < shelves; i += 1) {
      parts.push(rect(left + 10, top + 12 + i * shelfGap, opts.width - 20, 10, p.shade, 2));
    }
    // a few books / boxes to make the shelving read as furnished
    const rng = ctx.rng;
    for (let i = 0; i < shelves; i += 1) {
      const shelfY = top + 12 + (i + 1) * shelfGap;
      const count = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < count; j += 1) {
        const bw = 16 + rng() * 22;
        const bh = 40 + rng() * 40;
        parts.push(
          rect(
            left + 24 + j * (bw + 12) + rng() * 20,
            shelfY - bh,
            bw,
            bh,
            [p.accent, p.prop, '#9E6B4A', '#C9C3B8'][Math.floor(rng() * 4)] as string,
            3,
            'opacity="0.85"',
          ),
        );
      }
    }
  }

  parts.push(legs([left + 30, left + opts.width - 30], baseY, legHeight, 16, '#5A4632', 6));
  return parts.join('');
};

/** Dining, coffee, desk, island, countertop. */
const tableFamily = (
  ctx: Ctx,
  opts: {
    width: number;
    height: number;
    topThickness?: number;
    legStyle?: 'four' | 'frame' | 'panel' | 'cross';
    round?: boolean;
    withDrawers?: boolean;
  },
): string => {
  const { p } = ctx;
  const thickness = opts.topThickness ?? 26;
  const baseY = 700;
  const top = baseY - opts.height;
  const left = 600 - opts.width / 2;
  const legStyle = opts.legStyle ?? 'four';

  const tabletop = opts.round
    ? [
        ellipse(600, top + thickness / 2, opts.width / 2, thickness * 1.6, p.shade),
        ellipse(600, top + thickness / 2 - 6, opts.width / 2, thickness * 1.6, p.body),
        ellipse(600, top + thickness / 2 - 10, opts.width / 2 - 40, thickness * 1.1, p.highlight, 0.5),
      ].join('')
    : [
        rect(left, top, opts.width, thickness, p.body, 6),
        rect(left, top + thickness - 8, opts.width, 8, p.shade, 4),
        rect(left + 24, top + 6, opts.width - 48, 8, p.highlight, 4, 'opacity="0.6"'),
      ].join('');

  const legFill = '#5A4632';
  let base = '';
  if (legStyle === 'four') {
    base = legs(
      [left + 40, left + opts.width - 40],
      top + thickness,
      opts.height - thickness,
      20,
      legFill,
    );
  } else if (legStyle === 'frame') {
    base = [
      rect(left + 30, top + thickness, 16, opts.height - thickness, legFill, 4),
      rect(left + opts.width - 46, top + thickness, 16, opts.height - thickness, legFill, 4),
      rect(left + 30, baseY - 20, opts.width - 60, 14, legFill, 4),
    ].join('');
  } else if (legStyle === 'panel') {
    base = [
      rect(left + 20, top + thickness, 42, opts.height - thickness, p.shade, 4),
      rect(left + opts.width - 62, top + thickness, 42, opts.height - thickness, p.shade, 4),
    ].join('');
  } else {
    base = [
      `<path d="M${left + 60} ${baseY} L${left + opts.width - 60} ${top + thickness}" stroke="${legFill}" stroke-width="18" stroke-linecap="round"/>`,
      `<path d="M${left + opts.width - 60} ${baseY} L${left + 60} ${top + thickness}" stroke="${legFill}" stroke-width="18" stroke-linecap="round"/>`,
    ].join('');
  }

  const drawers = opts.withDrawers
    ? [
        rect(left + 30, top + thickness, opts.width - 60, 62, p.shade, 4),
        rect(left + 40, top + thickness + 8, (opts.width - 100) / 2, 46, p.highlight, 3),
        rect(left + 60 + (opts.width - 100) / 2, top + thickness + 8, (opts.width - 100) / 2, 46, p.highlight, 3),
      ].join('')
    : '';

  return [contactShadow(600, 708, opts.width * 0.5), base, drawers, tabletop].join('');
};

/** Chairs, stools, office chairs. */
const seatFamily = (
  ctx: Ctx,
  opts: { seatHeight: number; backStyle: 'slats' | 'shell' | 'upholstered' | 'mesh'; swivel?: boolean; armrests?: boolean },
): string => {
  const { p } = ctx;
  const baseY = 700;
  const seatY = baseY - opts.seatHeight;
  const seatWidth = 220;
  const left = 600 - seatWidth / 2;
  const backTop = seatY - (opts.backStyle === 'shell' ? 190 : 230);

  const back =
    opts.backStyle === 'slats'
      ? Array.from({ length: 4 }, (_, i) =>
          rect(left + 22 + i * 46, backTop, 26, seatY - backTop - 10, p.body, 12),
        ).join('')
      : opts.backStyle === 'mesh'
        ? [
            rect(left + 10, backTop, seatWidth - 20, seatY - backTop - 10, p.shade, 26),
            rect(left + 22, backTop + 12, seatWidth - 44, seatY - backTop - 36, shift(p.body, 0.25), 20, 'opacity="0.75"'),
            Array.from({ length: 6 }, (_, i) =>
              rect(left + 26, backTop + 20 + i * 22, seatWidth - 52, 4, p.line, 2, 'opacity="0.25"'),
            ).join(''),
          ].join('')
        : [
            rect(left + 6, backTop, seatWidth - 12, seatY - backTop - 6, p.shade, opts.backStyle === 'shell' ? 70 : 22),
            rect(left + 16, backTop + 10, seatWidth - 32, seatY - backTop - 28, p.body, opts.backStyle === 'shell' ? 60 : 18),
          ].join('');

  const arms = opts.armrests
    ? [
        rect(left - 14, seatY - 80, 18, 80, p.shade, 8),
        rect(left + seatWidth - 4, seatY - 80, 18, 80, p.shade, 8),
        rect(left - 20, seatY - 92, 70, 16, p.line, 8, 'opacity="0.8"'),
        rect(left + seatWidth - 50, seatY - 92, 70, 16, p.line, 8, 'opacity="0.8"'),
      ].join('')
    : '';

  const base = opts.swivel
    ? [
        rect(596, seatY + 40, 18, baseY - seatY - 70, '#8C8C8C', 6),
        `<path d="M600 ${baseY - 30} L520 ${baseY} M600 ${baseY - 30} L680 ${baseY} M600 ${baseY - 30} L600 ${baseY + 4}" stroke="#8C8C8C" stroke-width="14" stroke-linecap="round"/>`,
        ellipse(520, baseY + 4, 14, 8, '#6F6F6F'),
        ellipse(680, baseY + 4, 14, 8, '#6F6F6F'),
      ].join('')
    : legs(
        [left + 24, left + seatWidth - 24],
        seatY + 40,
        baseY - seatY - 40,
        16,
        '#5A4632',
        opts.seatHeight > 300 ? 0 : 10,
      ) +
      (opts.seatHeight > 300
        ? rect(left + 20, baseY - 120, seatWidth - 40, 12, '#5A4632', 6)
        : '');

  return [
    contactShadow(600, 706, 150),
    base,
    back,
    rect(left, seatY, seatWidth, 44, p.shade, 14),
    rect(left + 6, seatY + 4, seatWidth - 12, 34, p.body, 12),
    arms,
  ].join('');
};

/** Doors: leaf, frame, handle; panel treatment varies by type. */
const doorFamily = (
  ctx: Ctx,
  opts: { style: 'flat' | 'classic' | 'glass' | 'sliding' | 'hidden' | 'entrance' },
): string => {
  const { p } = ctx;
  const width = 340;
  const height = 620;
  const left = 600 - width / 2;
  const top = 740 - height;
  const parts: string[] = [contactShadow(600, 748, width * 0.6)];

  // frame
  parts.push(rect(left - 26, top - 26, width + 52, height + 26, shift(p.shade, -0.1), 4));
  parts.push(rect(left - 14, top - 14, width + 28, height + 14, shift(p.body, -0.05), 2));
  // leaf
  parts.push(rect(left, top, width, height, p.body, 2));
  parts.push(rect(left, top, 14, height, p.highlight, 0, 'opacity="0.5"'));

  if (opts.style === 'classic') {
    parts.push(rect(left + 34, top + 40, width - 68, 200, p.shade, 3));
    parts.push(rect(left + 44, top + 50, width - 88, 180, p.body, 2));
    parts.push(rect(left + 34, top + 270, width - 68, 300, p.shade, 3));
    parts.push(rect(left + 44, top + 280, width - 88, 280, p.body, 2));
  } else if (opts.style === 'glass') {
    parts.push(rect(left + 30, top + 36, width - 60, height - 120, '#D7E2E6', 3));
    parts.push(
      `<path d="M${left + 48} ${top + height - 140} L${width + left - 70} ${top + 60}" stroke="#FFFFFF" stroke-width="26" opacity="0.55" stroke-linecap="round"/>`,
    );
    parts.push(rect(left + 30, top + 36 + (height - 120) / 2 - 4, width - 60, 8, p.shade, 2));
  } else if (opts.style === 'entrance') {
    parts.push(rect(left + 26, top + 30, width - 52, height - 60, shift(p.body, -0.08), 3));
    parts.push(rect(left + 44, top + 48, width - 88, 150, p.highlight, 2, 'opacity="0.45"'));
    parts.push(rect(left + 44, top + 220, width - 88, 150, p.highlight, 2, 'opacity="0.45"'));
    parts.push(rect(left + 44, top + 392, width - 88, 150, p.highlight, 2, 'opacity="0.45"'));
    parts.push(ellipse(left + 52, top + height / 2 + 40, 10, 10, '#C0A15F'));
  } else if (opts.style === 'sliding') {
    parts.push(rect(left - 60, top - 44, width + 120, 16, '#8C8C8C', 8));
    parts.push(rect(left + 30, top + 40, width - 60, height - 100, p.highlight, 2, 'opacity="0.35"'));
    parts.push(rect(left + width - 70, top + height / 2 - 40, 34, 80, p.line, 6, 'opacity="0.55"'));
  } else if (opts.style === 'hidden') {
    parts.push(rect(left + 18, top + 18, width - 36, height - 36, p.highlight, 1, 'opacity="0.3"'));
  } else {
    parts.push(rect(left + 44, top + 60, width - 88, height - 150, p.highlight, 2, 'opacity="0.3"'));
  }

  if (opts.style !== 'hidden' && opts.style !== 'sliding' && opts.style !== 'entrance') {
    parts.push(rect(left + width - 46, top + height / 2 - 10, 34, 12, '#9B9B9B', 6));
    parts.push(ellipse(left + width - 32, top + height / 2 - 4, 9, 9, '#9B9B9B'));
  }
  return parts.join('');
};

/** Kitchen composition: wall cabinets, worktop, base units, optional island. */
const kitchenFamily = (ctx: Ctx, opts: { island?: boolean; tall?: boolean; cabinetOnly?: 'upper' | 'lower' | null; countertopOnly?: boolean }): string => {
  const { p } = ctx;
  const parts: string[] = [contactShadow(600, 730, 420)];

  if (opts.countertopOnly) {
    return [
      contactShadow(600, 690, 380),
      rect(220, 500, 760, 44, shift(p.body, -0.05), 6),
      rect(220, 500, 760, 12, p.highlight, 6, 'opacity="0.6"'),
      rect(220, 544, 760, 14, p.shade, 4),
      // material texture
      Array.from({ length: 16 }, (_, i) =>
        `<path d="M${250 + i * 45} 508 q 18 12 38 4" stroke="${p.shade}" stroke-width="3" fill="none" opacity="0.28"/>`,
      ).join(''),
    ].join('');
  }

  const upper = (x: number, width: number) =>
    [
      rect(x, 250, width, 180, p.shade, 4),
      rect(x + 6, 256, width - 12, 168, p.body, 3),
      rect(x + width / 2 - 30, 412, 60, 8, '#8C8C8C', 4),
    ].join('');
  const lower = (x: number, width: number) =>
    [
      rect(x, 520, width, 190, p.shade, 4),
      rect(x + 6, 526, width - 12, 178, p.body, 3),
      rect(x + width / 2 - 30, 536, 60, 8, '#8C8C8C', 4),
    ].join('');

  if (opts.cabinetOnly === 'upper') return [contactShadow(600, 640, 240), upper(420, 360)].join('');
  if (opts.cabinetOnly === 'lower') return [contactShadow(600, 726, 240), lower(420, 360)].join('');

  parts.push(upper(200, 250), upper(470, 240));
  if (opts.tall) {
    parts.push(rect(760, 250, 240, 460, p.shade, 4), rect(768, 258, 224, 444, p.body, 3));
    parts.push(rect(870, 450, 20, 90, '#8C8C8C', 8));
  } else {
    parts.push(upper(740, 250));
  }
  // worktop
  parts.push(rect(190, 496, opts.tall ? 570 : 820, 26, shift(p.body, -0.18), 4));
  parts.push(rect(190, 496, opts.tall ? 570 : 820, 8, '#FFFFFF', 4, 'opacity="0.35"'));
  // backsplash
  parts.push(rect(200, 430, 790, 66, shift(p.wallBottom, -0.04), 2));
  parts.push(lower(200, 250), lower(470, 250));
  if (!opts.tall) parts.push(lower(740, 250));
  // sink and hob details
  parts.push(rect(280, 470, 110, 26, '#B9BFC2', 6));
  parts.push(ellipse(560, 508, 34, 10, '#3A3D40', 0.8));

  if (opts.island) {
    // The island stands in front of the run: bigger, lower and with its own
    // shadow, so the shot reads as "kitchen with an island", not another row.
    parts.push(contactShadow(600, 800, 330));
    parts.push(rect(300, 640, 600, 28, shift(p.body, -0.22), 5));
    parts.push(rect(300, 640, 600, 9, '#FFFFFF', 5, 'opacity="0.35"'));
    parts.push(rect(320, 668, 560, 130, p.shade, 5));
    parts.push(rect(330, 676, 540, 114, p.body, 4));
    parts.push(rect(330, 676, 176, 114, p.highlight, 4, 'opacity="0.45"'));
    parts.push(rect(690, 676, 176, 114, p.highlight, 4, 'opacity="0.45"'));
    parts.push(rect(430, 700, 70, 8, '#8C8C8C', 4));
    parts.push(rect(700, 700, 70, 8, '#8C8C8C', 4));
    // two bar stools tucked under the overhang
    parts.push(
      ellipse(420, 638, 46, 12, p.shade, 0.5),
      ellipse(780, 638, 46, 12, p.shade, 0.5),
    );
  }
  return parts.join('');
};

const miscFamily = (ctx: Ctx, kind: 'coat-rack' | 'mirror' | 'shoe-rack'): string => {
  const { p } = ctx;
  if (kind === 'mirror') {
    return [
      contactShadow(600, 730, 200),
      rect(460, 180, 280, 540, p.shade, 140),
      rect(474, 194, 252, 512, '#D9E2E6', 126),
      `<path d="M510 640 L690 250" stroke="#FFFFFF" stroke-width="34" opacity="0.5" stroke-linecap="round"/>`,
      rect(520, 700, 160, 18, p.shade, 8),
    ].join('');
  }
  if (kind === 'coat-rack') {
    return [
      contactShadow(600, 726, 160),
      rect(590, 230, 20, 480, p.body, 8),
      `<path d="M600 300 L520 250 M600 300 L680 250 M600 360 L516 322 M600 360 L684 322" stroke="${p.shade}" stroke-width="16" stroke-linecap="round"/>`,
      ellipse(520, 248, 12, 12, p.accent),
      ellipse(680, 248, 12, 12, p.accent),
      `<path d="M600 700 L500 726 M600 700 L700 726 M600 700 L600 730" stroke="${p.shade}" stroke-width="18" stroke-linecap="round"/>`,
      // a coat hanging on the rack
      `<path d="M680 260 q 40 60 22 150 q -30 30 -60 4 q -12 -100 8 -150 Z" fill="${p.prop}" opacity="0.85"/>`,
    ].join('');
  }
  return [
    contactShadow(600, 722, 230),
    rect(380, 470, 440, 240, p.shade, 8),
    rect(388, 478, 424, 224, p.body, 6),
    rect(400, 500, 400, 12, p.shade, 4),
    rect(400, 580, 400, 12, p.shade, 4),
    rect(420, 512, 110, 60, p.prop, 8, 'opacity="0.8"'),
    rect(560, 512, 110, 60, p.accent, 8, 'opacity="0.7"'),
    rect(420, 592, 110, 60, p.accent, 8, 'opacity="0.6"'),
    rect(560, 592, 110, 60, p.prop, 8, 'opacity="0.6"'),
    rect(380, 430, 440, 40, shift(p.body, 0.2), 8),
  ].join('');
};

// -------------------------------------------------------------- selection ---

const drawFurniture = (ctx: Ctx): string => {
  const key = ctx.artKey;
  switch (key) {
    case 'sofa':
      return upholstered(ctx, { width: 720, seats: 3 });
    case 'sofa-corner':
      return upholstered(ctx, { width: 620, seats: 2, corner: 'right' });
    case 'sofa-modular':
      return upholstered(ctx, { width: 760, seats: 4, armStyle: 'low', backHeight: 180 });
    case 'sofa-small':
      return upholstered(ctx, { width: 480, seats: 2 });
    case 'armchair':
      return upholstered(ctx, { width: 320, seats: 1 });
    case 'armchair-lounge':
      return upholstered(ctx, { width: 340, seats: 1, armStyle: 'low', backHeight: 250, legHeight: 90 });
    case 'recliner':
      return upholstered(ctx, { width: 360, seats: 1, armStyle: 'square', recliner: true, legHeight: 20 });
    case 'bed':
      return bedFamily(ctx, { width: 760, headboard: 'upholstered' });
    case 'bed-single':
      return bedFamily(ctx, { width: 520, headboard: 'wooden' });
    case 'bed-kids':
      return bedFamily(ctx, { width: 540, headboard: 'wooden', kids: true });
    case 'mattress':
      return bedFamily(ctx, { width: 720, headboard: 'none', mattressOnly: true });
    case 'wardrobe':
      return caseFamily(ctx, { width: 620, height: 560, doors: 3, mirrorDoor: 1 });
    case 'wardrobe-sliding':
      return caseFamily(ctx, { width: 700, height: 560, doors: 2, sliding: true, mirrorDoor: 1, legHeight: 12 });
    case 'wardrobe-open':
      return caseFamily(ctx, { width: 680, height: 560, openShelves: 4, legHeight: 12 });
    case 'dresser':
      return caseFamily(ctx, { width: 520, height: 340, drawers: 4 });
    case 'nightstand':
      return caseFamily(ctx, { width: 280, height: 260, drawers: 2 });
    case 'shelving':
      return caseFamily(ctx, { width: 560, height: 520, openShelves: 5, legHeight: 20 });
    case 'tv-stand':
      return caseFamily(ctx, { width: 720, height: 210, doors: 2, drawers: 0, legHeight: 30 });
    case 'wall-system':
      return caseFamily(ctx, { width: 800, height: 480, doors: 4, openShelves: 0, legHeight: 16 });
    case 'hallway':
      return caseFamily(ctx, { width: 560, height: 500, doors: 2, mirrorDoor: 1, legHeight: 24 });
    case 'shoe-rack':
      return miscFamily(ctx, 'shoe-rack');
    case 'coat-rack':
      return miscFamily(ctx, 'coat-rack');
    case 'mirror':
      return miscFamily(ctx, 'mirror');
    case 'kids':
      return caseFamily(ctx, { width: 520, height: 420, doors: 2, drawers: 2, legHeight: 34 });
    case 'office':
      return caseFamily(ctx, { width: 600, height: 460, doors: 2, openShelves: 2, legHeight: 18 });
    case 'table':
      return tableFamily(ctx, { width: 720, height: 300, legStyle: 'four' });
    case 'table-coffee':
      return tableFamily(ctx, { width: 540, height: 160, legStyle: 'cross', topThickness: 22 });
    case 'desk':
      return tableFamily(ctx, { width: 640, height: 300, legStyle: 'frame', withDrawers: true });
    case 'countertop':
      return kitchenFamily(ctx, { countertopOnly: true });
    case 'kitchen':
      return kitchenFamily(ctx, {});
    case 'kitchen-island':
      return kitchenFamily(ctx, { island: true });
    case 'kitchen-tall':
      return kitchenFamily(ctx, { tall: true });
    case 'kitchen-cabinet':
      return kitchenFamily(ctx, { cabinetOnly: ctx.seed % 2 === 0 ? 'upper' : 'lower' });
    case 'chair':
      return seatFamily(ctx, { seatHeight: 250, backStyle: 'slats' });
    case 'chair-dining':
      return seatFamily(ctx, { seatHeight: 250, backStyle: 'upholstered' });
    case 'chair-designer':
      return seatFamily(ctx, { seatHeight: 240, backStyle: 'shell' });
    case 'bar-stool':
      return seatFamily(ctx, { seatHeight: 380, backStyle: 'shell' });
    case 'office-chair':
      return seatFamily(ctx, { seatHeight: 260, backStyle: 'mesh', swivel: true, armrests: true });
    case 'door-entrance':
      return doorFamily(ctx, { style: 'entrance' });
    case 'door-sliding':
      return doorFamily(ctx, { style: 'sliding' });
    case 'door-hidden':
      return doorFamily(ctx, { style: 'hidden' });
    case 'door-glass':
      return doorFamily(ctx, { style: 'glass' });
    case 'door-classic':
      return doorFamily(ctx, { style: 'classic' });
    case 'door':
      return doorFamily(ctx, { style: 'flat' });
    default:
      return caseFamily(ctx, { width: 560, height: 420, doors: 2 });
  }
};

// ------------------------------------------------------------------ props ---

const plant = (x: number, scale: number, color: string): string =>
  `<g transform="translate(${x} 700) scale(${scale})">
    <path d="M0 0 h70 l-10 -110 h-50 Z" fill="#B98A62"/>
    <path d="M-2 -110 h74 v-14 h-74 Z" fill="#A87A53"/>
    <path d="M35 -124 q -70 -30 -74 -120 q 60 10 74 120 Z" fill="${color}"/>
    <path d="M35 -124 q 70 -40 76 -130 q -64 16 -76 130 Z" fill="${color}" opacity="0.85"/>
    <path d="M35 -124 q -16 -80 6 -150 q 30 70 -6 150 Z" fill="${color}" opacity="0.92"/>
  </g>`;

const floorLamp = (x: number, color: string): string =>
  `<g transform="translate(${x} 700)">
    <rect x="-40" y="-6" width="80" height="10" rx="5" fill="#5A4632"/>
    <rect x="-5" y="-330" width="10" height="326" fill="#5A4632"/>
    <path d="M-52 -330 h104 l-22 -86 h-60 Z" fill="${color}"/>
    <ellipse cx="0" cy="-330" rx="52" ry="9" fill="#FFF6E2" opacity="0.9"/>
  </g>`;

const rug = (cx: number, color: string): string =>
  `<g opacity="0.75"><ellipse cx="${cx}" cy="742" rx="430" ry="58" fill="${color}"/><ellipse cx="${cx}" cy="742" rx="380" ry="46" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.4"/></g>`;

const wallArt = (x: number, y: number, color: string): string =>
  `<g><rect x="${x}" y="${y}" width="150" height="190" rx="4" fill="#FFFFFF" opacity="0.85"/><rect x="${x + 12}" y="${y + 12}" width="126" height="166" rx="2" fill="${color}" opacity="0.5"/><path d="M${x + 24} ${y + 150} l40 -60 l34 44 l26 -30 l24 46 Z" fill="#FFFFFF" opacity="0.65"/></g>`;

// ----------------------------------------------------------------- scenes ---

const defs = (p: ArtPalette): string => `
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.wallTop}"/>
      <stop offset="100%" stop-color="${p.wallBottom}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.floor}"/>
      <stop offset="100%" stop-color="${p.floorShade}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#3A3226" stop-opacity="0.33"/>
      <stop offset="100%" stop-color="#3A3226" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

const backdrop = (p: ArtPalette, floorY = 700): string =>
  `${rect(0, 0, ART_WIDTH, floorY, 'url(#wall)')}
   ${rect(0, floorY, ART_WIDTH, ART_HEIGHT - floorY, 'url(#floor)')}
   ${rect(0, floorY - 6, ART_WIDTH, 8, shift(p.wallBottom, -0.12))}
   <ellipse cx="600" cy="330" rx="520" ry="380" fill="url(#glow)"/>`;

/**
 * Renders one catalogue shot as a standalone SVG document.
 * Variant 0 studio · 1 angled · 2 detail · 3 room scene.
 */
export const renderArtwork = ({ artKey, colorKey, variant, seed }: ArtworkParams): string => {
  const p = buildPalette(colorKey);
  const rng = createRng(seed * 7919 + variant * 104729 + artKey.length * 31);
  const ctx: Ctx = { artKey, colorKey, variant, seed, p, rng };
  const furniture = drawFurniture(ctx);

  let scene: string;
  if (variant === 1) {
    // Angled "three-quarter" shot: a slight skew plus a stronger side light.
    // Doors are excluded from the skew — a leaning door leaf reads as broken,
    // not as a camera angle — so they get a plain closer framing instead.
    const isDoor = artKey.startsWith('door');
    scene = isDoor
      ? `${backdrop(p)}
        <g transform="translate(600 770) scale(1.06) translate(-600 -770)">${furniture}</g>
        ${rect(0, 0, 420, 700, '#FFFFFF', 0, 'opacity="0.10"')}`
      : `${backdrop(p)}
        <g transform="translate(600 760) scale(0.94 0.94) rotate(-1.2) translate(-600 -760)">
          <g transform="matrix(1,0,-0.08,1,60,0)">${furniture}</g>
        </g>
        ${rect(0, 0, 420, 700, '#FFFFFF', 0, 'opacity="0.10"')}`;
  } else if (variant === 2) {
    // Detail crop: scale 1.9 about the point the furniture actually occupies
    // (600, 560), nudged up so the piece fills the frame rather than the floor.
    scene = `${backdrop(p)}
      <g transform="translate(-540 -614) scale(1.9)">${furniture}</g>
      ${rect(0, 0, ART_WIDTH, ART_HEIGHT, '#000000', 0, 'opacity="0.02"')}`;
  } else if (variant === 3) {
    // Styled room scene with props around the product.
    const propColor = rng() > 0.5 ? p.prop : '#7E8C6A';
    scene = `${backdrop(p)}
      ${wallArt(140 + Math.floor(rng() * 40), 170, p.accent)}
      ${rug(600, shift(p.floorShade, 0.12))}
      <g transform="translate(600 770) scale(0.86) translate(-600 -770)">${furniture}</g>
      ${plant(950 + Math.floor(rng() * 40), 0.9 + rng() * 0.2, propColor)}
      ${floorLamp(200 + Math.floor(rng() * 30), shift(p.accent, 0.35))}`;
  } else {
    scene = `${backdrop(p)}${furniture}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_WIDTH} ${ART_HEIGHT}" width="${ART_WIDTH}" height="${ART_HEIGHT}" role="img">${defs(p)}${scene}</svg>`;
};

/** URL the catalogue stores for an image; the /media route renders it. */
export const artworkUrl = (artKey: string, colorKey: string, variant: ArtVariant, seed: number): string =>
  `/media/art/${artKey}--${colorKey}--${variant}--${seed}.svg`;

export const parseArtworkUrl = (
  slug: string,
): ArtworkParams | null => {
  const match = /^([a-z-]+)--([a-zA-Z]+)--([0-3])--(\d+)\.svg$/.exec(slug);
  if (!match) return null;
  return {
    artKey: match[1]!,
    colorKey: match[2]!,
    variant: Number(match[3]) as ArtVariant,
    seed: Number(match[4]),
  };
};
