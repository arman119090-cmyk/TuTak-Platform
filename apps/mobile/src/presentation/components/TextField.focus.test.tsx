import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TextField } from './TextField';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../app/theme/ThemeProvider');

const renderField = (props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <TextField label="Phone" traceId="phone" placeholder="00 000 000" {...props} />
    </ThemeProvider>,
  );

/**
 * What a field is allowed to change about itself when it takes focus.
 *
 * The device log showed focus refusing to stay where a tap put it: it
 * alternates between two fields and settles on the topmost one, whichever was
 * tapped, with no focus command from JavaScript anywhere in the run. That is
 * the shape of Android re-choosing a focus target —
 * `ScrollView.onRequestFocusInDescendants` with a null rect asks
 * `FocusFinder` for the first focusable child, and `ReactEditText` carries a
 * comment about exactly this, with a guard that only runs on Android 9 and
 * below.
 *
 * The only thing this component changed on focus that was not paint was
 * `elevation` — the view's Z on Android, which makes the parent rebuild its
 * ordered child list. These tests hold the focus ring to paint alone.
 */
describe('what a TextField changes when it is focused', () => {
  const ringOf = (element: { props: { style: unknown } }) =>
    StyleSheet.flatten(element.props.style) as Record<string, unknown>;

  it('adds no elevation to a focused field', () => {
    const { getByPlaceholderText, UNSAFE_getAllByType } = renderField();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');

    fireEvent(getByPlaceholderText('00 000 000'), 'focus');

    for (const view of UNSAFE_getAllByType(View)) {
      const style = ringOf(view as never);
      expect(style?.elevation).toBeUndefined();
    }
  });

  it('adds none when the field is showing an error either', () => {
    const { getByPlaceholderText, UNSAFE_getAllByType } = renderField({ error: 'nope' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');

    fireEvent(getByPlaceholderText('00 000 000'), 'focus');

    for (const view of UNSAFE_getAllByType(View)) {
      expect(ringOf(view as never)?.elevation).toBeUndefined();
    }
  });

  it('still tells the user which field is focused', () => {
    // The border and the fill are what say "you are here" now, so they have
    // to actually change — a fix that quietly removed the focus affordance
    // would be a different bug.
    const { getByPlaceholderText, UNSAFE_getAllByType } = renderField();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');

    const before = UNSAFE_getAllByType(View).map((v) => ringOf(v as never)?.borderColor);
    fireEvent(getByPlaceholderText('00 000 000'), 'focus');
    const after = UNSAFE_getAllByType(View).map((v) => ringOf(v as never)?.borderColor);

    expect(after).not.toEqual(before);
  });
});
