import React from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Screen } from './Screen';

/**
 * A screen you can enter and cannot leave.
 *
 * Every navigator in this app passes `headerShown: false`, so React
 * Navigation's own back arrow is never drawn — and this component drew a title
 * without one. Nine pushed screens had no way back on the display at all. It
 * was reported from "Invite a friend"; it was true of every one of them, and
 * of the sign-in screens too.
 *
 * Android's hardware button always worked, which is exactly why nobody caught
 * it: whoever built it never needed the control they had forgotten to draw.
 * iOS has no such button at all.
 */

// Prefixed with `mock` because jest forbids a factory from reaching any other
// out-of-scope name — a guard against a variable that is not initialised yet
// when the factory runs.
const mockGoBack = jest.fn();
let mockCanGoBack = true;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ canGoBack: () => mockCanGoBack, goBack: mockGoBack }),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../app/theme/ThemeProvider');

const renderScreen = (props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <Screen title="Invite a friend" {...props}>
        <Text>content</Text>
      </Screen>
    </ThemeProvider>,
  );

describe('Screen', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockCanGoBack = true;
  });

  it('offers a way back from a screen that was pushed', () => {
    renderScreen();
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });

  it('goes back when it is pressed', () => {
    renderScreen();
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('draws nothing on a screen there is nothing behind', () => {
    // The tab roots. An arrow that does nothing is worse than no arrow.
    mockCanGoBack = false;
    renderScreen();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('can be suppressed for a step that must be finished rather than left', () => {
    renderScreen({ hideBack: true });
    expect(screen.queryByLabelText('Back')).toBeNull();
  });
});
