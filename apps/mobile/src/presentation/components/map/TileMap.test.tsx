import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { TileMap } from './TileMap';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

/**
 * What a customer sees when the basemap will not load.
 *
 * Until this existed, every failure mode of the tile provider — no network,
 * a revoked key, a quota reached — rendered the same thing: an empty
 * rectangle, indistinguishable from a part of Yerevan with no partners in
 * it. The wrong conclusion was the easy one to draw.
 */
const LABEL = 'The map is unavailable right now.';

function renderMap(props: Partial<React.ComponentProps<typeof TileMap>> = {}) {
  const view = render(
    <ThemeProvider>
      <TileMap
        markers={[]}
        initialCentre={{ lat: 40.1772, lng: 44.5035 }}
        unavailableLabel={LABEL}
        {...props}
      />
    </ThemeProvider>,
  );
  // The map draws nothing until it has measured itself.
  act(() => {
    fireEvent(screen.UNSAFE_getByType(View), 'layout', {
      nativeEvent: { layout: { width: 320, height: 260 } },
    });
  });
  return view;
}

function tileImages() {
  return screen.UNSAFE_queryAllByType(Image);
}

describe('TileMap when the basemap fails', () => {
  it('says nothing while the tiles are arriving', () => {
    renderMap();
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('still says nothing when a single tile drops', () => {
    // One missing square is a dropped request. The map reads correctly around
    // it, and a warning there would cry wolf on every flaky connection.
    renderMap();
    const tiles = tileImages();
    expect(tiles.length).toBeGreaterThan(2);
    act(() => {
      fireEvent(tiles[0], 'error');
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('names the failure once most of the screenful is gone', () => {
    renderMap();
    const tiles = tileImages();
    act(() => {
      for (const tile of tiles) fireEvent(tile, 'error');
    });
    expect(screen.getByText(LABEL)).toBeTruthy();
  });

  it('stays silent when no label was supplied, rather than inventing one', () => {
    renderMap({ unavailableLabel: undefined });
    const tiles = tileImages();
    act(() => {
      for (const tile of tiles) fireEvent(tile, 'error');
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
