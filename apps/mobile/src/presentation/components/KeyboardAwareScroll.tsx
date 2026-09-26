import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Keyboard, ScrollView, ScrollViewProps, StyleSheet, View, ViewStyle } from 'react-native';
import { logEvent } from '../../diagnostics/eventLog';

/**
 * One place that knows how this app behaves when the keyboard is open.
 *
 * ## What the keyboard actually does to this app
 *
 * Expo enforces edge-to-edge on Android from SDK 54, and an edge-to-edge
 * window is **not** resized for the IME: the keyboard is drawn over the app
 * rather than shrinking it. So a form gets no help from the system at all —
 * whatever was at the bottom of the screen is now underneath the keyboard,
 * and on a sign-in form that is the sign-in button.
 *
 * Scrolling alone does not rescue it. `flexGrow: 1` on a form shorter than
 * the window makes the content exactly one window tall, so there is nothing
 * to scroll: the button is under the keyboard and stays there, unreachable,
 * however hard anyone swipes. That is the state this app shipped in — the
 * cost the previous revision of this file recorded as acceptable ("the form
 * scrolls, so the button is reachable") and which is only true of forms
 * taller than the window.
 *
 * The fix is to make the content taller by exactly what the keyboard took, so
 * there is something to scroll and the button can be brought above the fold.
 * See `useKeyboardInset` for why doing it this way cannot restart the layout
 * loop that `KeyboardAvoidingView` caused here.
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

/**
 * How much of the screen the keyboard is currently covering, in points.
 *
 * Read from the system's own keyboard event, never from measuring this
 * component. That distinction is the whole reason this is safe where
 * `KeyboardAvoidingView` was not: that view measured its own on-screen frame,
 * added padding to match, and thereby changed the frame it had just
 * measured — a layout that re-entered itself every frame, which is what made
 * these forms flicker and refuse to hold a keyboard. A number the IME
 * reports is an input to layout and never an output of it, so there is no
 * loop to enter.
 *
 * Android reports the height more than once per appearance — an approximate
 * value, a corrected one, then another when the suggestion strip opens — so
 * an unchanged value is returned as the same object and re-renders nothing.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // `Did`, not `Will`: Android only ever emits the `Did` pair, and using
    // the same events on both platforms keeps one behaviour to reason about.
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event.endCoordinates?.height ?? 0;
      // Recorded because the order of these against `focus`/`blur` is the
      // whole diagnosis. A keyboard that shows and hides with no `blur`
      // between them was closed by the system; one preceded by `blur` was
      // closed because the app dropped the focus, and those have nothing in
      // common but the symptom.
      logEvent(`kbShow h=${Math.round(height)}`);
      setInset((previous) => (Math.abs(previous - height) < 1 ? previous : height));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      logEvent('kbHide');
      setInset(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return inset;
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
  const keyboardInset = useKeyboardInset();

  // Flattened so the keyboard's height *adds to* whatever bottom padding the
  // screen asked for rather than overwriting it. Every auth screen passes one
  // (`paddingBottom: 40`), and replacing it would take clearance away at the
  // exact moment more is needed. A non-numeric value — a percentage — is left
  // alone and the inset stands on its own.
  const content: ViewStyle = StyleSheet.flatten<ViewStyle>([styles.content, contentContainerStyle]);
  const requested = typeof content.paddingBottom === 'number' ? content.paddingBottom : 0;
  /*
   * A plain scrolling list plus one number, and no cleverness beyond that.
   *
   * ## What was removed, and why it stays removed
   *
   * Seven attempts failed to make these forms typeable on Android:
   * `keyboardDismissMode`, a debounce on `keyboardDidShow`, an epsilon on a
   * computed scroll target, a lock during the scroll animation, a retry after
   * that lock, switching autofill off — and finally stripping the lot to find
   * out which of them was the culprit.
   *
   * That last step answered it. What none of the first six touched, and what
   * `git log -S` shows had been changed exactly once, was
   * `KeyboardAvoidingView behavior="padding"`. On Android that view measures
   * the keyboard's overlap against its *own frame* and adds padding to match —
   * which moves the frame it just measured, which changes the overlap, which
   * changes the padding. A layout that cannot settle, and a field inside it
   * that flickers and cannot hold a keyboard.
   *
   * So it does not come back, and neither do `scrollTargetFor` and
   * `shouldIssueScroll` below — both still exported and tested, both currently
   * called by nothing, kept because the next person to want auto-scrolling
   * should start from arithmetic that has been checked rather than from a
   * fresh guess.
   *
   * ## What replaced it
   *
   * `useKeyboardInset` reads the height the IME *reports* and adds it to the
   * content's bottom padding. That is not the same shape of thing at all: a
   * reported height is an input to layout, so nothing this component does can
   * change it, and there is no loop to enter. The scroll view's own frame is
   * never consulted and never moves.
   *
   * The effect is that the content becomes taller than the window by exactly
   * what the keyboard covers, so the list has somewhere to scroll to and the
   * submit button can be brought above the fold. Without it a form shorter
   * than the window has content exactly one window tall, nothing to scroll,
   * and a button that is under the keyboard permanently — which is the state
   * this shipped in.
   */
  return (
    <FormScrollContext.Provider value={NO_SCROLLING}>
      <ScrollView
        style={[styles.flex, style]}
        // The only thing standing between a short form and a submit button
        // nobody can reach.
        contentContainerStyle={[
          content,
          keyboardInset > 0 ? { paddingBottom: requested + keyboardInset } : null,
        ]}
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
