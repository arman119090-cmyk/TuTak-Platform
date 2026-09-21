'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children at the end of <body>.
 *
 * A full-screen overlay must be positioned against the viewport, but
 * `position: fixed` is measured against the nearest ancestor that has a
 * transform, a filter or a backdrop-filter — and the sticky header has
 * `backdrop-blur`. An overlay declared inside it was therefore sized to the
 * header, and its contents spilled over the page instead of covering it.
 * Moving the overlay out of that subtree is what keeps `fixed` meaning
 * "the screen".
 */

/** Nothing to subscribe to: the answer only ever changes by hydrating. */
const noop = () => () => {};

export const Portal = ({ children }: { children: ReactNode }) => {
  // False while rendering on the server, true in the browser — without the
  // extra render an effect-driven flag would cost.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  if (!mounted) return null;
  return createPortal(children, document.body);
};
