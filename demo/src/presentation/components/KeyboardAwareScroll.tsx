import React, { createContext, useCallback, useContext } from 'react';
import { ScrollView, ScrollViewProps, StyleSheet, View } from 'react-native';

/**
 * One place that knows how this app behaves when the keyboard is open.
 *
 * ## Why `behavior="padding"` on Android too
 *
 * The screens used to pass `Platform.OS === 'ios' ? 'padding' : undefined`,
 * which is the advice from the years when Android windows were resized by the
 * system for the keyboard: with `adjustResize` doing that work, adding padding
 * as well would push the content twice as far as it needed to go.
 *
 * That stopped being true. Expo enforces edge-to-edge on Android from SDK 54,
 * and an edge-to-edge window is not resized for the IME — so `undefined`
 * means nothing happens at all, and the keyboard covers whatever was at the
 * bottom of the screen, which on a login form is the login button.
 *
 * `padding` is correct on both platforms *and* safe if a window does still
 * resize, because React Native measures the keyboard's overlap against this
 * view's own on-screen frame (`_relativeKeyboardHeight` in
 * `KeyboardAvoidingView.js`). On a window that resized, the frame already
 * ends above the keyboard, the overlap computes as zero, and no padding is
 * added. There is nothing to double up.
 *
 * ## Why the scrolling is not optional
 *
 * A small phone with the system font scale turned up has a few hundred points
 * of usable height once the keyboard is open. Nothing sensible fits. Every
 * form in this app therefore scrolls; `flexGrow: 1` keeps a short form
 * positioned as designed rather than squashed to the top; and
 * `keyboardShouldPersistTaps="handled"` means the first tap on a button is
 * the button, not a tap that only dismisses the keyboard and has to be
 * repeated.
 */

interface FormScrollValue {
  /**
   * Brings a field into view above the keyboard.
   *
   * Android does not scroll a focused input into view on its own, and the
   * field a person is typing into is the one thing that must never be hidden.
   */
  ensureVisible(node: View | null): void;
}

const FormScrollContext = createContext<FormScrollValue | null>(null);

/**
 * Nothing scrolls a field into view while the apparatus is out.
 *
 * A no-op rather than a removed context, so `TextField` needs no change and
 * whatever comes back can come back here alone.
 */
const NO_SCROLLING: FormScrollValue = { ensureVisible: () => undefined };

/**
 * Used by `TextField`. Safe to call whether or not there is a scrolling
 * ancestor — a field on a screen that does not scroll simply does nothing.
 */
export function useEnsureVisibleOnFocus(): (node: View | null) => void {
  const context = useContext(FormScrollContext);
  return useCallback((node: View | null) => context?.ensureVisible(node), [context]);
}

export interface KeyboardAwareScrollProps extends ScrollViewProps {
  children: React.ReactNode;
}

/** Breathing room between the bottom of a focused field and the keyboard. */
const FIELD_CLEARANCE = 16;

/** What `reveal` measured, in the scroll view's own coordinates. */
export interface RevealGeometry {
  /** Top of the focused field. */
  fieldTop: number;
  fieldHeight: number;
  /** Height of the visible area — smaller once the keyboard has taken its share. */
  viewportHeight: number;
  /** Where the list is scrolled to right now. */
  scrollY: number;
}

/**
 * Where the list should scroll to so the focused field clears the keyboard,
 * or `null` when it should not scroll at all.
 *
 * Pulled out of the component because it is the whole decision, and because
 * the alternative is testing it through `measureLayout`, which needs a native
 * node no test environment here can produce. A copy of this arithmetic written
 * inside a test would agree with itself whatever either one said.
 *
 * The `null` cases are the ones that matter. A scroll to the offset the list
 * already occupies is not a no-op: `keyboardDidShow` fires more than once on
 * Android — the IME reports a new height when its suggestion strip appears —
 * and two measurements of one layout can differ by a fraction of a point. One
 * scroll request per firing, forever, is what that costs, and this component
 * has already been half of one self-sustaining loop.
 */
export function scrollTargetFor(g: RevealGeometry): number | null {
  const fieldBottom = g.fieldTop + g.fieldHeight + FIELD_CLEARANCE;
  const visibleBottom = g.scrollY + g.viewportHeight;

  // Nothing measured in constants: where the field is, how tall the visible
  // area is after the keyboard took its share, and where the list is already
  // scrolled to. A field that is already fully visible is left exactly where
  // it is — scrolling under someone's fingers when nothing needed to move is
  // its own kind of broken.
  let target: number | null = null;
  if (fieldBottom > visibleBottom) {
    target = fieldBottom - g.viewportHeight;
  } else if (g.fieldTop < g.scrollY) {
    target = Math.max(g.fieldTop - FIELD_CLEARANCE, 0);
  }

  if (target === null) return null;
  return Math.abs(target - g.scrollY) >= 1 ? target : null;
}

/**
 * How far a new target has to be from the last one to be worth acting on.
 *
 * The keyboard's reported height moves by five to ten points between its own
 * reports, so a target recomputed from it moves by the same amount. Below this
 * the difference is the IME correcting itself rather than the field needing to
 * move.
 */
const TARGET_EPSILON = 5;

/** Everything that decides whether a scroll request is worth issuing. */
export interface ScrollGate {
  target: number;
  /** The last target actually scrolled to, or null if none yet. */
  lastTarget: number | null;
  /** Whether a smooth scroll is believed to still be running. */
  isScrolling: boolean;
}

/**
 * Whether to issue this scroll.
 *
 * Separate from the component because it is the whole decision and because
 * `reveal` can only be driven through `measureLayout`, which needs a native
 * node no test environment here can produce. Written as a function rather than
 * as three conditions inside a callback so the rules are checked against real
 * code instead of against a copy of themselves.
 */
export function shouldIssueScroll(gate: ScrollGate): boolean {
  // A scroll started less than an animation ago is still moving. Interrupting
  // it restarts the animation from wherever it had got to, which is the jerk.
  if (gate.isScrolling) return false;

  // The first scroll of an interaction always happens: there is nothing to
  // compare against and the field genuinely needs revealing.
  if (gate.lastTarget === null) return true;

  return Math.abs(gate.target - gate.lastTarget) >= TARGET_EPSILON;
}

export function KeyboardAwareScroll({
  children,
  contentContainerStyle,
  style,
  ...rest
}: KeyboardAwareScrollProps) {
  /*
   * Stripped to a plain scrolling list, on purpose, and this is a measurement
   * rather than a fix.
   *
   * ## Why
   *
   * Six attempts have now failed to make these forms typeable on Android:
   * `keyboardDismissMode`, a debounce on `keyboardDidShow`, an epsilon on the
   * scroll target, a lock during the scroll animation, a retry after that
   * lock, and switching autofill off. Each was reasoned from the source, each
   * was consistent with the evidence, and the fault survived all six on three
   * different handsets — including in the demonstration build, which has no
   * network, no server and no autofill service to blame.
   *
   * That last one is the fact that matters: it is this component, and nothing
   * outside it.
   *
   * Everything removed here was added in `9ad672a` or later. What was NOT
   * removed by any of the six attempts, and what `git log -S` confirms has
   * been touched exactly once — in `9ad672a` itself — is
   * `KeyboardAvoidingView behavior="padding"`. On Android that view measures
   * the keyboard's overlap against its own frame and adds padding to match. If
   * the window is also resized for the keyboard, the frame shrinks, the
   * overlap recomputes, the padding changes, and the frame changes again: a
   * layout that cannot settle. A field inside a view re-laying-out every frame
   * is a field that flickers and cannot hold a keyboard.
   *
   * So the whole apparatus goes, at once, and what remains is the simplest
   * thing that can possibly work. If the forms are usable now, the fault is in
   * what was removed and it can be reintroduced one piece at a time. If they
   * are still not, then it is not this component at all and six rounds have
   * been spent in the wrong file — which is worth knowing after one build
   * rather than after a seventh guess.
   *
   * ## The cost, stated plainly
   *
   * The keyboard can now cover the submit button on a short screen. The form
   * scrolls, so the button is reachable; it is simply not moved out of the way
   * for you. That was the problem `9ad672a` set out to fix, and it is a much
   * smaller problem than a form nobody can type into.
   */
  return (
    <FormScrollContext.Provider value={NO_SCROLLING}>
      <ScrollView
        style={[styles.flex, style]}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        // The only prop kept from the original. Without it the first tap on a
        // button while the keyboard is open merely closes the keyboard, and
        // has to be repeated — which reads as the button being broken. It
        // cannot cause a loop: it changes what a tap does, not what the layout
        // does.
        keyboardShouldPersistTaps="handled"
        {...rest}
      >
        {children}
      </ScrollView>
    </FormScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // `flexGrow`, not `flex`: the content keeps its natural height and only
  // stretches to fill a tall screen. With `flex: 1` a form taller than the
  // window would be compressed instead of scrolled.
  content: { flexGrow: 1 },
});
