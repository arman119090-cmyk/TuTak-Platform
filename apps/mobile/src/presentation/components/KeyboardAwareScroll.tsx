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

  const reveal = useCallback((node: View | null) => {
    const scroll = scrollRef.current;
    if (!node || !scroll || viewportHeight.current === 0) return;

    const inner = findNodeHandle(scroll.getInnerViewNode?.() ?? null);
    if (inner == null) return;

    node.measureLayout(
      inner,
      (_x, y, _width, height) => {
        const fieldBottom = y + height + FIELD_CLEARANCE;
        const visibleBottom = scrollY.current + viewportHeight.current;

        // Nothing measured in constants: where the field is, how tall the
        // visible area is after the keyboard took its share, and where the
        // list is already scrolled to. A field that is already fully visible
        // is left exactly where it is — scrolling under someone's fingers
        // when nothing needed to move is its own kind of broken.
        if (fieldBottom > visibleBottom) {
          scroll.scrollTo({ y: fieldBottom - viewportHeight.current, animated: true });
        } else if (y < scrollY.current) {
          scroll.scrollTo({ y: Math.max(y - FIELD_CLEARANCE, 0), animated: true });
        }
      },
      () => {
        // The node can be gone by the time this resolves. A field that
        // unmounts while focusing is odd; it is not worth a crash.
      },
    );
  }, []);

  const ensureVisible = useCallback(
    (node: View | null) => {
      focusedNode.current = node;
      reveal(node);
    },
    [reveal],
  );

  useEffect(() => {
    // Focus fires before the keyboard has finished animating, so the viewport
    // measured at that moment is still the full-height one. Running again on
    // `keyboardDidShow` is what makes the field reliably visible rather than
    // usually visible.
    const shown = Keyboard.addListener('keyboardDidShow', () => reveal(focusedNode.current));
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      focusedNode.current = null;
    });
    return () => {
      shown.remove();
      hidden.remove();
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
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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
