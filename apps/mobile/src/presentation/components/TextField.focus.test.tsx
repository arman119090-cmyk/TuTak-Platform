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
 * The focus affordance, held in place across the experiments.
 *
 * Two candidate fixes have now been tried against this component and the
 * device log has judged both. What a test has to protect through that is the
 * plain thing a user relies on: tapping a field must visibly mark it.
 */
describe('what a TextField changes when it is focused', () => {
  const ringOf = (element: { props: { style: unknown } }) =>
    StyleSheet.flatten(element.props.style) as Record<string, unknown>;

  it('still tells the user which field is focused', () => {
    // The affordance itself, pinned. `elevation` was taken out of the ring as
    // a candidate fix and put back when the device log showed the fault
    // unchanged; what must not happen in the course of that kind of
    // experiment is the focus indication quietly disappearing.
    const { getByPlaceholderText, UNSAFE_getAllByType } = renderField();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');

    const before = UNSAFE_getAllByType(View).map((v) => ringOf(v as never)?.borderColor);
    fireEvent(getByPlaceholderText('00 000 000'), 'focus');
    const after = UNSAFE_getAllByType(View).map((v) => ringOf(v as never)?.borderColor);

    expect(after).not.toEqual(before);
  });
});
