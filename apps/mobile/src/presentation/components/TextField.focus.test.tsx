import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TextField } from './TextField';

// Deliberately NOT a diagnostic build for most of this file: the fix below
// must hold in the app people install, not only in the build that measures it.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
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
 * The fix, and the two ways it could be lost again.
 *
 * The field box is a Fabric "layout only" node at rest: a background and a
 * border give it a native view, but with no `shadowColor` and no `elevation`
 * it is not a stacking context, so its children are mounted into the wrapper
 * above rather than into it. Taking focus adds the ring's `shadowColor`, the
 * node becomes a stacking context, and the differ reparents its children —
 * detaching the focused `ReactEditText` and re-inserting it under a different
 * parent. Android drops the focus off a view it no longer owns, and the
 * keyboard goes with it.
 *
 * `collapsable={false}` pins that trait true in both states. Confirmed on a
 * handset in build 41 across off → on → off (runs SS06VF and 0HX8CM). It is
 * unconditional here on purpose, so the two ways to lose it are: making it
 * conditional again (on a flag, an arm, or a diagnostic build), or letting a
 * refactor take the ring or the handlers with it.
 */
describe('the field box never collapses', () => {
  const boxOf = (utils: ReturnType<typeof renderField>) => {
    // The box is the View that draws the border — the only one with a
    // borderWidth, and the node the prop belongs to.
    const views = utils.UNSAFE_getAllByType(View);
    return views.find(
      (view) => (StyleSheet.flatten(view.props.style) as { borderWidth?: number })?.borderWidth === 1,
    );
  };

  it('carries collapsable={false} in an ordinary build, with no diagnostics anywhere', () => {
    // The mock above says `extra: {}` — not a diagnostic build. A fix that
    // only applies where the instrument is watching is not a fix.
    expect(boxOf(renderField())?.props.collapsable).toBe(false);
  });

  it('carries it on every field, prefixed or not, with an error or without', () => {
    expect(boxOf(renderField({ prefix: '+374' }))?.props.collapsable).toBe(false);
    expect(boxOf(renderField({ error: 'nope' }))?.props.collapsable).toBe(false);
    expect(boxOf(renderField({ secureTextEntry: true }))?.props.collapsable).toBe(false);
  });

  it('still marks the focused field and still accepts typing', () => {
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

  it("still calls the screen's own focus and blur handlers", () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const input = renderField({ onFocus, onBlur }).getByPlaceholderText('00 000 000');

    fireEvent(input, 'focus');
    fireEvent(input, 'blur');

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  /**
   * The forbidden repairs, pinned as absences.
   *
   * Every one of these was ruled out before the cause was known — a re-focus
   * on blur, a timer that re-opens the keyboard, a forced `focus()` on mount.
   * They paper over a symptom and make the next fault unreadable, and the fix
   * above needs none of them. This fails if one is ever added.
   */
  it('never re-focuses the input itself and starts no timers', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const utils = renderField();
      const input = utils.getByPlaceholderText('00 000 000');
      const focus = jest.fn();
      // Whatever the component holds a ref to, calling focus on it is what a
      // re-focus repair would have to do.
      Object.defineProperty(input, 'focus', { value: focus, configurable: true });

      fireEvent(input, 'focus');
      fireEvent(input, 'blur');
      jest.advanceTimersByTime(5000);

      expect(focus).not.toHaveBeenCalled();
      // One timer only: the diagnostic `tags`/`shape` probe, which reads and
      // never writes. Anything beyond it is a repair that should not be here.
      expect(setTimeoutSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
