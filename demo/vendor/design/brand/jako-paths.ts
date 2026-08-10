/**
 * Jako's geometry, shared by every platform.
 *
 * React Native renders these through react-native-svg and the web apps
 * render them as inline SVG, so the mark is defined exactly once. Anything
 * that draws Jako must import from here — never re-trace or re-export a
 * copy, or the mark will drift between the app and the dashboards.
 *
 * Canvas is a 48×48 grid.
 */

export const JAKO_VIEWBOX = '0 0 48 48';

/** Full-colour mark. Draw in array order; each entry carries its own fill. */
export const jakoPaths = [
  {
    id: 'tail',
    d: 'M17.6 32.4 8.9 41.1a2.1 2.1 0 0 0 1.5 3.6h4.2c1.2 0 2.3-.5 3.1-1.4l4.6-5.2-4.7-5.7Z',
    token: 'brand',
  },
  {
    id: 'body',
    d: 'M31.6 8.2c-6.9 0-12.6 5.2-13.3 11.9l-.7 6.6a9.9 9.9 0 0 0 2.4 7.6l2.6 2.9a8 8 0 0 0 5.9 2.6h1.9c6.6 0 12-5.4 12-12V20.5c0-6.8-5.4-12.3-12-12.3h1.2Z',
    token: 'body',
  },
  {
    id: 'crown',
    d: 'M30.4 4.6c-7.1 0-12.9 5.8-12.9 12.9v3.9c0 3 2.4 5.4 5.4 5.4h9.3c5.6 0 10.1-4.5 10.1-10.1v-.7c0-6.3-5.1-11.4-11.4-11.4h-.5Z',
    token: 'crown',
  },
  {
    id: 'beak',
    d: 'M18.4 13.9c-3.5.3-6.2 2.4-7.5 5-.5 1-.2 2.2.7 2.8l2.2 1.5c.6.4 1.4.5 2.1.2l3.9-1.6c1-.4 1.6-1.4 1.5-2.4l-.3-3.6a2 2 0 0 0-2.1-1.9h-.5Z',
    token: 'beak',
  },
  {
    id: 'beakShadow',
    d: 'M13.8 23.2c1.5.9 3.4.9 4.9 0l1.4-.9-3.6 1.5c-.7.3-1.5.2-2.1-.2l-.6-.4Z',
    token: 'beakShadow',
  },
  {
    id: 'scallops',
    d: 'M31.4 28.6a2.4 2.4 0 1 1 4.8 0 2.4 2.4 0 0 1-4.8 0ZM25.9 31.9a2.4 2.4 0 1 1 4.8 0 2.4 2.4 0 0 1-4.8 0ZM36.7 32.4a2.4 2.4 0 1 1 4.8 0 2.4 2.4 0 0 1-4.8 0Z',
    token: 'scallops',
    opacity: 0.75,
  },
] as const;

export type JakoPathToken = (typeof jakoPaths)[number]['token'];

/** Eye is drawn as ellipse + circles rather than paths, so it stays crisp. */
export const jakoEye = {
  patch: { cx: 24.6, cy: 15.4, rx: 4.6, ry: 4.9 },
  pupil: { cx: 24.2, cy: 15.4, r: 2.1 },
  catchlight: { cx: 25.1, cy: 14.5, r: 0.7 },
} as const;

/**
 * Single-path silhouette used for the watermark treatment — the ghosted
 * Jako behind a balance card. One path so it can be filled with a single
 * low-opacity colour and never reads as an illustration.
 */
export const jakoSilhouette =
  'M30.4 4.6c-7.1 0-12.9 5.8-12.9 12.9v.4c-3.2.6-5.6 2.6-6.8 5-.5 1-.2 2.2.7 2.8l2.2 1.5c.6.4 1.4.5 2.1.2l1.6-.7-.4 4a9.9 9.9 0 0 0 2.4 7.6l.3.3-11 11a2.1 2.1 0 0 0 1.6 3.7h4.2c1.2 0 2.3-.5 3.1-1.4l4.6-5.2a8 8 0 0 0 3.5.8h1.9c6.6 0 12-5.4 12-12V16.7c0-6.7-5.4-12.1-12.1-12.1h-.5Z';

/**
 * Default fill mapping. Platforms pass their own resolved palette so the
 * mark can be recoloured (e.g. all-white on a dark splash) without forking.
 */
export interface JakoColors {
  brand: string;
  body: string;
  crown: string;
  beak: string;
  beakShadow: string;
  scallops: string;
  eyePatch: string;
  pupil: string;
  catchlight: string;
}
