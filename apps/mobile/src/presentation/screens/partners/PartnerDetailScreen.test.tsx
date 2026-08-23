import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PartnerDetailScreen } from './PartnerDetailScreen';
import { partnersApi } from '../../../data/api/partnersApi';
import type { NearbyPartnerDto, PartnerPublicDto } from '@tutak/shared-types';

/**
 * The map/explore redesign (2026-08-23) adds `NearbyPartnerDto.cover` to
 * this screen — `TUTAK_UI_UX_MASTER_SPEC_V2.md` §2/§5. These tests prove:
 * a real cover renders at the top of the card, a partner with none renders
 * the pre-existing logo-only card rather than a broken/empty cover block,
 * and a cover URL that fails to load degrades to that same logo-only
 * presentation instead of a dead grey rectangle.
 *
 * The partner public profile (2026-08-23) adds a second block: this screen
 * now fetches `GET /partners/:id` on mount for `about`/`offerings`, neither
 * of which is on `NearbyPartnerDto` — see the screen's own doc comment for
 * why. The "about"/"offerings" tests below prove the section renders only
 * once that fetch resolves and only when there is something to show —
 * present, absent, and empty-list are all covered, matching this project's
 * "don't render an empty section" rule.
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

jest.mock('../../../data/api/partnersApi', () => ({ partnersApi: { get: jest.fn() } }));

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

const detailFixture = (overrides: Partial<PartnerPublicDto> = {}): PartnerPublicDto => ({
  id: 'partner-1',
  displayName: 'SAS Supermarket',
  category: 'grocery' as PartnerPublicDto['category'],
  bonusAccrualRateBps: 300,
  isActive: true,
  createdAt: new Date().toISOString(),
  logo: null,
  cover: null,
  about: null,
  offerings: [],
  ...overrides,
});

let mockRoutePartner: NearbyPartnerDto = basePartner;
let activeClient: QueryClient | undefined;
let activeUnmount: (() => void) | undefined;

function renderScreen(partner: NearbyPartnerDto = basePartner) {
  mockRoutePartner = partner;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PartnerDetailScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('PartnerDetailScreen', () => {
  afterEach(() => {
    // React Query keeps background refetch/gc timers alive past the test's
    // own assertions unless the client and tree are torn down explicitly —
    // same reasoning as `CreatePurchaseIntentScreen.test.tsx`.
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
  });

  describe('cover photo', () => {
    it('renders no cover block, only the logo card, when the partner has published none', () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(detailFixture());
      renderScreen(basePartner);

      const images = screen.UNSAFE_getAllByType(Image);
      expect(images.every((img) => !String(img.props.source?.uri ?? '').includes('cover'))).toBe(
        true,
      );
    });

    it('renders the published cover at the top of the card, 3:2', () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(detailFixture());
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
      (partnersApi.get as jest.Mock).mockResolvedValue(detailFixture());
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

  describe('about / offerings', () => {
    it('shows nothing extra before the server fetch resolves', () => {
      (partnersApi.get as jest.Mock).mockImplementation(() => new Promise(() => undefined));
      renderScreen();

      expect(screen.queryByText('partners.about')).toBeNull();
      expect(screen.queryByText('partners.offerings')).toBeNull();
    });

    it('renders no "about" section when the partner has not written one', async () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(detailFixture({ about: null }));
      renderScreen();

      await waitFor(() => expect(partnersApi.get).toHaveBeenCalledWith('partner-1'));
      expect(screen.queryByText('partners.about')).toBeNull();
    });

    it('renders the about text once the fetch resolves', async () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(
        detailFixture({ about: 'We roast our own beans daily.' }),
      );
      renderScreen();

      await screen.findByText('partners.about');
      expect(screen.getByText('We roast our own beans daily.')).toBeTruthy();
    });

    it('renders no offerings section when the list is empty', async () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(detailFixture({ offerings: [] }));
      renderScreen();

      await waitFor(() => expect(partnersApi.get).toHaveBeenCalledWith('partner-1'));
      expect(screen.queryByText('partners.offerings')).toBeNull();
    });

    it('renders each offering with its name, price and description', async () => {
      (partnersApi.get as jest.Mock).mockResolvedValue(
        detailFixture({
          offerings: [
            { id: 'o1', name: 'Espresso', description: 'Double shot', price: '1500' },
            { id: 'o2', name: 'Latte', description: null, price: '2000' },
          ],
        }),
      );
      renderScreen();

      await screen.findByText('partners.offerings');
      expect(screen.getByText('Espresso')).toBeTruthy();
      expect(screen.getByText('Double shot')).toBeTruthy();
      expect(screen.getByText('Latte')).toBeTruthy();
      // Both rows' prices are on screen — no cart/order affordance, just a
      // read-only list.
      expect(screen.getByText('1 500 ֏')).toBeTruthy();
      expect(screen.getByText('2 000 ֏')).toBeTruthy();
      expect(screen.queryByText('purchaseIntent.payHere')).toBeTruthy(); // unrelated CTA still present
    });
  });
});
