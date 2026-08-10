import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
  findNodeHandle,
} from 'react-native';
import { logEvent } from '../../diagnostics/eventLog';

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
 * How long Android is given to stop changing its mind about the keyboard.
 *
 * One appearance produces several `keyboardDidShow` events: an approximate
 * height first, a corrected one after, and another when the suggestion strip
 * appears. Acting on each of them is several scrolls where one was wanted.
 * 200ms is longer than the gap between those reports and shorter than a person
 * moving between fields.
 */
const KEYBOARD_SETTLE_MS = 200;

/**
 * How long a smooth scroll is assumed to take.
 *
 * React Native does not say when `scrollTo({ animated: true })` has finished,
 * so this stands in for it. A second scroll issued mid-animation cancels the
 * first and restarts, which is visible as a jerk.
 */
const SCROLL_ANIMATION_MS = 300;

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
  onLayout,
  onScroll,
  ...rest
}: KeyboardAwareScrollProps) {
  const scrollRef = useRef<ScrollView>(null);
  /** How tall the scrollable window is *right now* — it shrinks with the keyboard. */
  const viewportHeight = useRef(0);
  const scrollY = useRef(0);
  /** Re-consulted when the keyboard finishes opening, not only on focus. */
  const focusedNode = useRef<View | null>(null);
  /** The last offset actually scrolled to, so near-identical repeats are dropped. */
  const lastTarget = useRef<number | null>(null);
  /** Raised for the length of a smooth scroll, so a second one cannot cut it short. */
  const isScrolling = useRef(false);
  /** Timers, held so they can be cleared on unmount rather than firing into nothing. */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when a scroll was refused only because another was still animating. */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Declared before `reveal` so the retry below can call it, and assigned from
  // `reveal` itself. A plain recursive `useCallback` cannot refer to the
  // callback it is defining.
  const revealRef = useRef<(node: View | null) => void>(() => undefined);

  const reveal = useCallback((node: View | null) => {
    const scroll = scrollRef.current;
    if (!node || !scroll || viewportHeight.current === 0) return;

    const inner = findNodeHandle(scroll.getInnerViewNode?.() ?? null);
    if (inner == null) return;

    node.measureLayout(
      inner,
      (_x, y, _width, height) => {
        const target = scrollTargetFor({
          fieldTop: y,
          fieldHeight: height,
          viewportHeight: viewportHeight.current,
          scrollY: scrollY.current,
        });
        if (target === null) {
          // Logged too. "The app decided not to scroll" and "the app never
          // got here" look identical in a log that only records actions, and
          // they point at different faults.
          logEvent('scroll skipped (in view)');
          return;
        }

        if (!shouldIssueScroll({ target, lastTarget: lastTarget.current, isScrolling: isScrolling.current })) {
          // Which guard refused is the useful part: `busy` means scrolls are
          // arriving faster than they finish, `same` means the keyboard is
          // still settling. Different faults, same appearance.
          if (isScrolling.current) {
            // `busy` must be retried, and `same` must not.
            //
            // The debounced reveal is the *only* one that measures the window
            // with the keyboard already in it — the one on focus runs against
            // the full-height viewport, before anything has moved. Dropping it
            // because a scroll happened to still be animating leaves the field
            // under the keyboard with nothing scheduled to correct it, which
            // is precisely the failure this component exists to prevent.
            //
            // One hop is enough to terminate: the lock is cleared at most
            // SCROLL_ANIMATION_MS after it was raised, and it was raised no
            // later than now, so by the time this fires it is down. A further
            // retry only happens if a *new* scroll was issued meanwhile, which
            // is progress rather than a loop.
            //
            // `same` is a genuine decision that nothing needs to move, and
            // retrying it would reinstate the repetition the epsilon exists to
            // stop.
            logEvent('scroll skipped (busy) → retry');
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => {
              revealRef.current(node);
            }, SCROLL_ANIMATION_MS);
          } else {
            logEvent('scroll skipped (same)');
          }
          return;
        }

        logEvent(`scroll y=${Math.round(target)}`);
        lastTarget.current = target;
        isScrolling.current = true;
        if (scrollTimer.current) clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => {
          isScrolling.current = false;
        }, SCROLL_ANIMATION_MS);

        scroll.scrollTo({ y: target, animated: true });
      },
      () => {
        // The node can be gone by the time this resolves. A field that
        // unmounts while focusing is odd; it is not worth a crash.
      },
    );
  }, []);

  revealRef.current = reveal;

  const ensureVisible = useCallback(
    (node: View | null) => {
      focusedNode.current = node;
      // A tap is one event and needs no settling — the delay belongs to the
      // keyboard's own reports, not to the person.
      lastTarget.current = null;
      reveal(node);
    },
    [reveal],
  );

  useEffect(() => {
    // Focus fires before the keyboard has finished animating, so the viewport
    // measured at that moment is still the full-height one. Running again on
    // `keyboardDidShow` is what makes the field reliably visible rather than
    // usually visible.
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      // The height is the point. Android reports a first approximate value
      // and then a corrected one, and reports again when the suggestion strip
      // appears — so a run of `kbShow` at two or three different heights is
      // ordinary, and a run of forty is the fault.
      logEvent(`kbShow h=${Math.round(event.endCoordinates?.height ?? 0)}`);

      // Debounced, not acted on directly. Each report restarts the clock, so a
      // burst of them produces one `reveal` after the burst rather than one
      // per report — and the one that runs measures the keyboard's final
      // height instead of an intermediate guess.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        reveal(focusedNode.current);
      }, KEYBOARD_SETTLE_MS);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      logEvent('kbHide');
      // A pending reveal for a keyboard that has gone would scroll to a field
      // nobody is in.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      // A retry for a keyboard that has gone would scroll to a field nobody
      // is in, exactly as a pending reveal would.
      if (retryTimer.current) clearTimeout(retryTimer.current);
      focusedNode.current = null;
      lastTarget.current = null;
    });
    return () => {
      shown.remove();
      hidden.remove();
      // Both timers hold a closure over a scroll view that is going away. A
      // pending one firing after unmount is a scroll into nothing at best.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [reveal]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
      onLayout?.(event);
    },
    [onLayout],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  const value = useMemo<FormScrollValue>(() => ({ ensureVisible }), [ensureVisible]);

  return (
    <FormScrollContext.Provider value={value}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          ref={scrollRef}
          style={[styles.flex, style]}
          contentContainerStyle={[styles.content, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          /*
           * Android dismisses nothing when this view scrolls, and that is not
           * a preference — `on-drag` and `reveal()` cannot both exist here.
           *
           * This component scrolls itself, programmatically, every time the
           * keyboard appears: `keyboardDidShow` calls `reveal()`, which calls
           * `scrollTo`. Android's `on-drag` closes the keyboard when the list
           * scrolls, and does not distinguish a scroll the app asked for from
           * one a finger caused. So: tap a field, the keyboard opens,
           * `keyboardDidShow` fires, the app scrolls, `on-drag` closes the
           * keyboard — and the field still holds focus, so the IME comes
           * straight back and the whole thing repeats. The screen flickers and
           * nothing can be typed.
           *
           * Reported on two different handsets, on the four screens that use
           * this component — which are the four sign-in screens, the only ones
           * where anything is typed before an account exists. Invisible to
           * every check here: react-native-web has no IME, so the browser
           * drive that now runs in CI cannot see it, and neither can Jest.
           *
           * `interactive` on iOS is a swipe-down gesture, not a reaction to
           * scrolling, so it does not have this problem and is worth keeping.
           */
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
          showsVerticalScrollIndicator={false}
          onLayout={handleLayout}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          {...rest}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </FormScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // `flexGrow`, not `flex`: the content keeps its natural height and only
  // stretches to fill a tall screen. With `flex: 1` a form taller than the
  // window would be compressed instead of scrolled, which is the failure this
  // file exists to prevent.
  content: { flexGrow: 1 },
});
