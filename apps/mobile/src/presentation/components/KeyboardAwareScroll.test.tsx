import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { KeyboardAwareScroll, scrollTargetFor, shouldIssueScroll } from './KeyboardAwareScroll';
import { TextField } from './TextField';
import { ThemeProvider } from '../../app/theme/ThemeProvider';

/**
 * The properties that decide whether a form is usable with the keyboard open.
 *
 * These are structural assertions, and deliberately so: the failure they
 * guard against is not a wrong pixel, it is a prop reverting to the value it
 * had for years. `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`
 * is what every screen in this app used to pass, it reads as careful, and on
 * a modern edge-to-edge Android window it means the keyboard covers the
 * submit button. Nothing in a screenshot test would catch that; a test on the
 * prop does.
 */

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
  };
});

const renderScroll = () =>
  render(
    <ThemeProvider>
      <KeyboardAwareScroll>
        <Text>content</Text>
      </KeyboardAwareScroll>
    </ThemeProvider>,
  );

/**
 * Jest runs as iOS by default, which is exactly the platform where the old
 * conditional gave the right answer. A test that did not say "android" here
 * passed with the bug present — it did, on the first attempt — so the
 * platform is set explicitly and both branches are named.
 */
function asPlatform(os: 'ios' | 'android', run: () => void) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  }
}

describe('KeyboardAwareScroll', () => {
  it('avoids the keyboard by padding on Android, where it used to do nothing', () => {
    asPlatform('android', () => {
      renderScroll();
      // `undefined` is the regression, and Android is the only place it shows:
      // an edge-to-edge window is not resized for the keyboard, so nothing
      // moves and the submit button stays underneath it.
      expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    });
  });

  it('avoids the keyboard by padding on iOS as well', () => {
    asPlatform('ios', () => {
      renderScroll();
      expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    });
  });

  it('lets the first tap reach the button under the keyboard', () => {
    renderScroll();
    const scroll = screen.UNSAFE_getByType(ScrollView);

    // Without this, tapping "Log in" while the keyboard is open only closes
    // the keyboard, and the person has to tap again — which reads as the
    // button being broken.
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('lets content taller than the window scroll rather than compressing it', () => {
    renderScroll();
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const content = Object.assign({}, ...[scroll.props.contentContainerStyle].flat());

    // `flexGrow` positions a short form as designed on a tall screen *and*
    // lets a long one extend past the fold. `flex: 1` would squash it.
    expect(content.flexGrow).toBe(1);
    expect(content.flex).toBeUndefined();
  });

  it('never dismisses the keyboard when this view scrolls on Android', () => {
    // This test used to assert `on-drag`, and passing was the problem.
    //
    // `on-drag` closes the keyboard whenever the list scrolls, and Android
    // does not distinguish a scroll the app asked for from one a finger
    // caused. This component asks for one on every `keyboardDidShow`. The two
    // together are a loop: keyboard opens, app scrolls the field into view,
    // `on-drag` closes the keyboard, the field still holds focus so the IME
    // returns, and round again. On a handset that is a screen that flickers
    // and a form that cannot be typed into — reported on two different
    // devices, on the four sign-in screens, which are the four screens that
    // use this component.
    //
    // Written as two literals rather than the expression the component uses,
    // which would agree with itself whatever it said — and named for the
    // property that matters rather than for the value, because the value was
    // the bug.
    asPlatform('android', () => {
      renderScroll();
      expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('none');
    });
    // iOS keeps `interactive`: that is a downward swipe on the keyboard
    // itself, not a reaction to the list moving, so it cannot close a keyboard
    // the app has just scrolled a field under.
    asPlatform('ios', () => {
      renderScroll();
      expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('interactive');
    });
  });

});

/**
 * The other half of the loop, and the half that survives a change of platform.
 *
 * This is the real function the component calls — not a copy of its arithmetic
 * written here, which would agree with itself whatever either one said. It is
 * exported for exactly that reason: the alternative is driving it through
 * `measureLayout`, which needs a native node no test environment here can
 * produce.
 */
describe('scrollTargetFor', () => {
  const visible = { viewportHeight: 600, scrollY: 0 };

  it('scrolls a field hidden below the keyboard just far enough to clear it', () => {
    // Field occupies 700..754; the visible area ends at 600. It needs to end
    // 16pt above the fold: 754 + 16 - 600.
    expect(scrollTargetFor({ ...visible, fieldTop: 700, fieldHeight: 54 })).toBe(170);
  });

  it('scrolls back up to a field above the top of the visible area', () => {
    expect(scrollTargetFor({ viewportHeight: 600, scrollY: 300, fieldTop: 100, fieldHeight: 54 })).toBe(84);
  });

  it('never scrolls past the top', () => {
    expect(scrollTargetFor({ viewportHeight: 600, scrollY: 10, fieldTop: 4, fieldHeight: 54 })).toBe(0);
  });

  it('leaves a field that is already fully visible exactly where it is', () => {
    expect(scrollTargetFor({ ...visible, fieldTop: 100, fieldHeight: 54 })).toBeNull();
  });

  it('does not ask to scroll to the offset the list is already at', () => {
    // `keyboardDidShow` fires more than once on Android — the IME reports a
    // new height when its suggestion strip appears — and two measurements of
    // one layout can differ by a fraction of a point. Without this, that is
    // one scroll request per firing, forever.
    const target = scrollTargetFor({ viewportHeight: 600, scrollY: 170, fieldTop: 700, fieldHeight: 54 });
    expect(target).toBeNull();

    // Half a point of measurement noise is still nothing to do.
    expect(
      scrollTargetFor({ viewportHeight: 600, scrollY: 169.6, fieldTop: 700, fieldHeight: 54 }),
    ).toBeNull();

    // A real difference still moves.
    expect(
      scrollTargetFor({ viewportHeight: 600, scrollY: 100, fieldTop: 700, fieldHeight: 54 }),
    ).toBe(170);
  });
});

/**
 * The three guards in front of `scrollTo`, checked against the real function
 * the component calls rather than a copy of its conditions.
 *
 * They exist because Android reports the keyboard's height several times per
 * appearance — approximate, corrected, then again for the suggestion strip —
 * and each report recomputes a target five to ten points from the last. One
 * scroll per report is several scrolls where one was wanted, each cancelling
 * the animation of the one before it.
 */
describe('shouldIssueScroll', () => {
  it('always scrolls the first time, with nothing to compare against', () => {
    expect(shouldIssueScroll({ target: 170, lastTarget: null, isScrolling: false })).toBe(true);
  });

  it('refuses while a scroll is still animating', () => {
    // Interrupting a smooth scroll restarts it from wherever it had reached,
    // which is the jerk. Even a target far from the last one waits.
    expect(shouldIssueScroll({ target: 400, lastTarget: 170, isScrolling: true })).toBe(false);
  });

  it('refuses the first scroll of an interaction too if one is already running', () => {
    expect(shouldIssueScroll({ target: 170, lastTarget: null, isScrolling: true })).toBe(false);
  });

  it.each([
    ['identical', 170],
    ['a point away', 171],
    ['just under the epsilon', 174.9],
    ['just under the epsilon, downwards', 165.1],
  ])('refuses a target %s from the last one', (_case, target) => {
    // Five points is the keyboard correcting its own reported height, not the
    // field needing to move.
    expect(shouldIssueScroll({ target, lastTarget: 170, isScrolling: false })).toBe(false);
  });

  it.each([
    ['exactly the epsilon', 175],
    ['well beyond it', 400],
    ['beyond it, upwards', 100],
  ])('scrolls for a target %s from the last one', (_case, target) => {
    expect(shouldIssueScroll({ target, lastTarget: 170, isScrolling: false })).toBe(true);
  });
});

describe('TextField sizing', () => {
  it('grows with the system font scale instead of clipping', () => {
    render(
      <ThemeProvider>
        <TextField label="Phone" value="" onChangeText={() => {}} />
      </ThemeProvider>,
    );

    const input = screen.UNSAFE_getByType(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react-native').TextInput,
    );
    const field = input.parent;
    const style = Object.assign({}, ...[field?.props.style].flat().filter(Boolean));

    // A fixed height clipped the text on a phone with large fonts: the box
    // kept its size and the characters lost theirs.
    expect(style.minHeight).toBe(54);
    expect(style.height).toBeUndefined();
  });
});
