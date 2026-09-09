import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TextField } from './TextField';
import { resetExperiment, toggleCollapsableField } from '../../diagnostics/experiment';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true } } },
}));

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

/**
 * The `CF` arm, and the two things that make it a controlled comparison.
 *
 * The prop has to actually appear when the arm is on and actually be absent
 * when it is off — a prop that is always sent, or never sent, turns the trial
 * into two runs of the same configuration. And the focus affordance has to
 * survive the flip: an arm that also removes the ring is not one parameter,
 * it is two, and the test above would no longer be protecting anything.
 */
describe('the collapsable arm on the field box', () => {
  afterEach(resetExperiment);

  const boxOf = (utils: ReturnType<typeof renderField>) => {
    // The field box is the View that draws the border — the only one with a
    // borderWidth, and the node the arm acts on.
    const views = utils.UNSAFE_getAllByType(View);
    return views.find(
      (view) => (StyleSheet.flatten(view.props.style) as { borderWidth?: number })?.borderWidth === 1,
    );
  };

  it('sends no collapsable prop at all while the arm is off', () => {
    expect(boxOf(renderField())?.props.collapsable).toBeUndefined();
  });

  it('sends collapsable={false} once the arm is on', () => {
    toggleCollapsableField();

    expect(boxOf(renderField())?.props.collapsable).toBe(false);
  });

  it('keeps the focus ring and the typing in both arms', () => {
    toggleCollapsableField();
    const onChangeText = jest.fn();
    const utils = renderField({ onChangeText });
    const input = utils.getByPlaceholderText('00 000 000');

    const before = StyleSheet.flatten(boxOf(utils)?.props.style) as { borderColor?: string };
    fireEvent(input, 'focus');
    const after = StyleSheet.flatten(boxOf(utils)?.props.style) as { borderColor?: string };
    fireEvent.changeText(input, '12345678');

    expect(after.borderColor).not.toBe(before.borderColor);
    expect(onChangeText).toHaveBeenCalledWith('12345678');
  });
});
