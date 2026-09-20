import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { JAKO_STATES, JakoHero, jakoAsset } from './JakoHero';

/**
 * The mapping is the contract: a screen asks for a state and must get an
 * image, for every state the brand set defines, with the same figure size
 * on every screen. The tests are deliberately about that contract rather
 * than about pixels, which only a device can show.
 */
describe('JakoHero', () => {
  it('covers all fourteen states of the brand set with a distinct asset', () => {
    expect(JAKO_STATES).toHaveLength(14);
    const assets = JAKO_STATES.map((state) => jakoAsset(state));
    expect(new Set(assets).size).toBe(14);
  });

  it.each(JAKO_STATES)('renders an image for %s', (state) => {
    render(<JakoHero state={state} />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props.source).toBe(jakoAsset(state));
    expect(image.props.contentFit).toBe('contain');
  });

  it('is decorative: hidden from screen readers and not touchable', () => {
    render(<JakoHero state="login" />);
    // Hidden from assistive tech is the point, so the query has to opt in.
    const wrap = screen.getByTestId('jako-login', { includeHiddenElements: true });
    expect(wrap.props.accessible).toBe(false);
    expect(wrap.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wrap.props.pointerEvents).toBe('none');
  });

  it('draws the same figure at one size per variant, so Jako is one character everywhere', () => {
    render(
      <>
        <JakoHero state="password" size="compact" testID="a" />
        <JakoHero state="confirm" size="compact" testID="b" />
      </>,
    );
    const heightOf = (id: string) => {
      const style = screen.getByTestId(id, { includeHiddenElements: true }).props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
      return flat.height;
    };
    expect(heightOf('a')).toBe(heightOf('b'));
  });

  it('never animates in — the same on a reduced-motion setting and off it', () => {
    render(<JakoHero state="success" />);
    expect(screen.UNSAFE_getByType(Image).props.transition).toBe(0);
  });
});
