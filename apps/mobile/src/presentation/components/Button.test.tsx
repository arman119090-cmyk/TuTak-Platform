import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Button } from './Button';
import { ThemeProvider } from '../../app/theme/ThemeProvider';

/**
 * The same defect `TextField` was fixed for, in the control next to it.
 *
 * Android's display settings offer a font scale well above 1 — Samsung's One
 * UI puts it two taps from the home screen — and this button set a fixed
 * `height` with `overflow: 'hidden'`. The box kept its size while the label
 * grew, so the characters were cut off: a primary action reading "Log i".
 */

const renderButton = (props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <Button label="Log in" onPress={() => {}} {...props} />
    </ThemeProvider>,
  );

const shapeOf = () =>
  Object.assign(
    {},
    ...[screen.getByRole('button').props.style].flat().filter(Boolean),
  );

describe('Button sizing', () => {
  it('grows with the system font scale instead of clipping', () => {
    renderButton();
    const style = shapeOf();

    expect(style.minHeight).toBe(54);
    // The assertion that matters: a fixed height is what clipped the label.
    expect(style.height).toBeUndefined();
  });

  it.each([
    ['lg', 54],
    ['md', 46],
    ['sm', 38],
  ])('keeps the %s size as a floor, not a ceiling', (size, expected) => {
    renderButton({ size });
    expect(shapeOf().minHeight).toBe(expected);
  });

  it('caps the scale so a label cannot turn the button into a paragraph', () => {
    renderButton();
    // Honour the preference, but not without limit: past roughly a third
    // larger a two-word label wraps to a third line.
    expect(screen.getByText('Log in').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('records that the small size sits below the minimum touch target', () => {
    // `layout.minTouchTarget` is 44 and `sm` is 38, which is under it. That
    // is deliberate — `sm` is for a control inside a row that is itself
    // tappable — but it is worth pinning rather than rediscovering, so that
    // anyone reaching for `sm` as a standalone button sees this first.
    renderButton({ size: 'sm' });
    expect(shapeOf().minHeight).toBeLessThan(44);
  });
});

describe('Button content', () => {
  it('lets a long Armenian or Russian label wrap inside the button', () => {
    // Both languages run noticeably longer than the English these widths
    // were chosen against. Without `flexShrink` the row pushes its icon off
    // the edge instead of wrapping.
    renderButton({ label: 'Հաստատել վճարումը', icon: <Text>i</Text> });
    const row = screen.getByText('Հաստատել վճարումը').parent;
    const style = Object.assign({}, ...[row?.props.style].flat().filter(Boolean));
    expect(style.flexShrink).toBe(1);
  });
});
