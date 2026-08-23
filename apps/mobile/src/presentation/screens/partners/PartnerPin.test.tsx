import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Image } from 'react-native';
import { PartnerPin } from './PartnerPin';

/**
 * The map pin's own logo, per Arman's confirmed request, 2026-08-23:
 * "заменить иконку категории на карте на логотип партнёра" — the category
 * icon becomes the fallback (`PartnerMark`'s new `fallback` prop), used
 * only when the partner has no logo, or the logo failed to load.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function renderPin(props: Partial<React.ComponentProps<typeof PartnerPin>> = {}) {
  return render(
    <ThemeProvider>
      <PartnerPin
        name="SAS Supermarket"
        category={'grocery' as React.ComponentProps<typeof PartnerPin>['category']}
        cashbackPercent={3}
        selected={false}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('PartnerPin', () => {
  it('renders the category icon when the partner has no logo', () => {
    renderPin({ logoUrl: null });

    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    // `CATEGORY_ICONS.grocery` — asserted indirectly via the Ionicons glyph
    // name below, since the icon itself renders as a font glyph.
    expect(screen.UNSAFE_getAllByProps({ name: 'basket-outline' }).length).toBeGreaterThan(0);
  });

  it("renders the partner's own logo when one is published", () => {
    renderPin({ logoUrl: 'https://cdn.example/logo-128.jpg' });

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0]?.props.source).toEqual({ uri: 'https://cdn.example/logo-128.jpg' });
    // No category icon underneath while the logo is showing.
    expect(screen.UNSAFE_queryAllByProps({ name: 'basket-outline' })).toHaveLength(0);
  });

  it('falls back to the category icon when the logo fails to load', () => {
    renderPin({ logoUrl: 'https://cdn.example/broken.jpg' });

    const logo = screen.UNSAFE_getAllByType(Image)[0];
    act(() => {
      logo?.props.onError?.();
    });

    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(screen.UNSAFE_getAllByProps({ name: 'basket-outline' }).length).toBeGreaterThan(0);
  });

  it('sizes the logo to fit inside the selected disc without overlapping its border', () => {
    renderPin({ logoUrl: 'https://cdn.example/logo-128.jpg', selected: true });

    const images = screen.UNSAFE_getAllByType(Image);
    // Selected disc is 34pt with a 2pt border on each side — the mark must
    // sit inside that, not span the full disc and collide with the ring.
    expect(images[0]?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 30, height: 30 })]),
    );
  });
});
