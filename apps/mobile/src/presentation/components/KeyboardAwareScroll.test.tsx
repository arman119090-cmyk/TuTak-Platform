import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { KeyboardAwareScroll } from './KeyboardAwareScroll';
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

  it('dismisses the keyboard on drag on Android, interactively on iOS', () => {
    // Written as two literals rather than the same expression the component
    // uses, which would agree with itself whatever it said.
    asPlatform('android', () => {
      renderScroll();
      expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('on-drag');
    });
    asPlatform('ios', () => {
      renderScroll();
      expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('interactive');
    });
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
