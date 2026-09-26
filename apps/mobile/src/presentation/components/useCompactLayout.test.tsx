import React from 'react';
import { Dimensions, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { useCompactLayout } from './useCompactLayout';

/**
 * The defect these are written against: this hook decided "is this a small
 * phone" from the *window*, and on Android the window shrinks when the
 * keyboard opens. On a handset whose windowed height straddles 700 the flag
 * flipped mid-interaction, the form re-laid-out under a keyboard that was
 * still animating, the focused field lost focus and the keyboard closed —
 * "the keyboard appears for a second and goes straight back out".
 *
 * So the assertion that matters is not what the flag is. It is that opening
 * the keyboard cannot change it.
 */

function Probe() {
  return <Text>{String(useCompactLayout())}</Text>;
}

type Size = { width: number; height: number };

/** Drives `Dimensions` the way React Native does: one screen, one window. */
function mockDimensions(screenSize: Size, windowSize: Size) {
  const listeners: Array<(sizes: { window: Size; screen: Size }) => void> = [];
  let current = { screen: screenSize, window: windowSize };

  jest
    .spyOn(Dimensions, 'get')
    .mockImplementation((dim) => (dim === 'screen' ? current.screen : current.window) as never);
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation((_event, handler) => {
    listeners.push(handler as (sizes: { window: Size; screen: Size }) => void);
    return { remove: () => undefined } as never;
  });

  return {
    /** What Android does when the IME opens: the window shrinks, the screen does not. */
    openKeyboard(by: number) {
      current = {
        screen: current.screen,
        window: { ...current.window, height: current.window.height - by },
      };
      act(() => listeners.forEach((l) => l(current)));
    },
    /** What a rotation or a foldable opening does: both change. */
    resizeScreen(next: Size) {
      current = { screen: next, window: next };
      act(() => listeners.forEach((l) => l(current)));
    },
  };
}

afterEach(() => jest.restoreAllMocks());

it('calls a tall device roomy', () => {
  mockDimensions({ width: 400, height: 900 }, { width: 400, height: 880 });
  render(<Probe />);
  expect(screen.getByText('false')).toBeTruthy();
});

it('calls a short device compact', () => {
  mockDimensions({ width: 320, height: 640 }, { width: 320, height: 620 });
  render(<Probe />);
  expect(screen.getByText('true')).toBeTruthy();
});

it('does not flip when the keyboard shrinks the window past the threshold', () => {
  // 780 of screen, 760 of window — above the 700 line, and far enough above
  // it that only a keyboard could push the window under.
  const dimensions = mockDimensions({ width: 400, height: 780 }, { width: 400, height: 760 });
  render(<Probe />);
  expect(screen.getByText('false')).toBeTruthy();

  // A 340-point keyboard leaves 420 points of window: comfortably under 700,
  // which is what used to flip the flag and re-lay-out the form.
  dimensions.openKeyboard(340);

  expect(screen.getByText('false')).toBeTruthy();
});

it('does not flip the other way either, on a small phone', () => {
  const dimensions = mockDimensions({ width: 320, height: 660 }, { width: 320, height: 640 });
  render(<Probe />);
  expect(screen.getByText('true')).toBeTruthy();

  dimensions.openKeyboard(300);

  expect(screen.getByText('true')).toBeTruthy();
});

it('still reacts when the screen itself changes, as a fold or a rotation does', () => {
  const dimensions = mockDimensions({ width: 400, height: 900 }, { width: 400, height: 880 });
  render(<Probe />);
  expect(screen.getByText('false')).toBeTruthy();

  // Rotated: the screen is now wider than it is tall, and short enough to
  // count as compact.
  dimensions.resizeScreen({ width: 900, height: 400 });

  expect(screen.getByText('true')).toBeTruthy();
});
