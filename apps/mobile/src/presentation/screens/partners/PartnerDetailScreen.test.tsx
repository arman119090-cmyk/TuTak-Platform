import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Image } from 'react-native';
import { PartnerDetailScreen } from './PartnerDetailScreen';
import type { NearbyPartnerDto } from '@tutak/shared-types';

/**
 * The map/explore redesign (2026-08-23) adds `NearbyPartnerDto.cover` to
 * this screen — `TUTAK_UI_UX_MASTER_SPEC_V2.md` §2/§5. These tests prove:
 * a real cover renders at the top of the card, a partner with none renders
 * the pre-existing logo-only card rather than a broken/empty cover block,
 * and a cover URL that fails to load degrades to that same logo-only
 * presentation instead of a dead grey rectangle.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    canGoBack: () => true,
    goBack: jest.fn(),
    getState: () => ({ type: 'stack' }),
  }),
  useRoute: () => ({ params: { partner: mockRoutePartner } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const basePartner: NearbyPartnerDto = {
  id: 'branch-1',
  partnerId: 'partner-1',
  name: 'SAS Supermarket',
  branchName: 'Cascade',
  category: 'grocery' as NearbyPartnerDto['category'],
  address: '10 Tamanyan St',
  city: 'Yerevan',
  latitude: 40.19,
  longitude: 44.51,
  cashbackPercent: 3,
  distanceKm: 1.5,
  logo: null,
  cover: null,
};

let mockRoutePartner: NearbyPartnerDto = basePartner;

function renderScreen(partner: NearbyPartnerDto) {
  mockRoutePartner = partner;
  return render(
    <ThemeProvider>
      <PartnerDetailScreen />
    </ThemeProvider>,
  );
}

describe('PartnerDetailScreen — cover photo', () => {
  it('renders no cover block, only the logo card, when the partner has published none', () => {
    renderScreen(basePartner);

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.every((img) => !String(img.props.source?.uri ?? '').includes('cover'))).toBe(
      true,
    );
  });

  it('renders the published cover at the top of the card, 3:2', () => {
    const partner: NearbyPartnerDto = {
      ...basePartner,
      cover: {
        assetId: 'asset-cover-1',
        url: 'https://cdn.example/cover-1024.jpg',
        thumbnailUrl: 'https://cdn.example/cover-128.jpg',
        width: 1024,
        height: 683,
      },
    };

    renderScreen(partner);

    const images = screen.UNSAFE_getAllByType(Image);
    const cover = images.find((img) => img.props.source?.uri === 'https://cdn.example/cover-1024.jpg');
    expect(cover).toBeTruthy();
    expect(cover?.props.style).toEqual(
      expect.objectContaining({ aspectRatio: 3 / 2, width: '100%' }),
    );
  });

  it('falls back to the logo-only presentation when the cover image fails to load, rather than an empty box', () => {
    const partner: NearbyPartnerDto = {
      ...basePartner,
      cover: {
        assetId: 'asset-cover-2',
        url: 'https://cdn.example/broken-cover.jpg',
        thumbnailUrl: 'https://cdn.example/broken-cover-thumb.jpg',
        width: 1024,
        height: 683,
      },
    };

    renderScreen(partner);

    const before = screen.UNSAFE_getAllByType(Image);
    const cover = before.find(
      (img) => img.props.source?.uri === 'https://cdn.example/broken-cover.jpg',
    );
    expect(cover).toBeTruthy();

    act(() => {
      cover?.props.onError?.();
    });

    const after = screen.UNSAFE_getAllByType(Image);
    expect(
      after.some((img) => img.props.source?.uri === 'https://cdn.example/broken-cover.jpg'),
    ).toBe(false);
    // The category caption — the rest of the logo/category block — is still
    // on screen; only the failed photo disappeared.
    expect(screen.getByText('partnerCategory.grocery')).toBeTruthy();
  });
});
