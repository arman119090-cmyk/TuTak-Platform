import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatePurchaseIntentScreen } from './CreatePurchaseIntentScreen';
import { partnersApi } from '../../../data/api/partnersApi';
import { walletApi } from '../../../data/api/walletApi';

/**
 * GitHub issue #28 (HIGH, 2026-08-16): this screen used to trust
 * `route.params.partnerName` outright, which a QR scan never even supplies
 * (`ScanQrScreen` only extracts `partnerId`). These tests prove the screen
 * now always resolves the partner from the server before letting the
 * customer see or use the amount form, and never falls back to the
 * unverified route param once that resolution completes.
 */

const mockReplace = jest.fn();
const routeParams: { partnerId: string; partnerBranchId?: string; partnerName?: string } = {
  partnerId: 'partner-1',
  partnerName: 'Unverified Route Placeholder',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    canGoBack: () => true,
    goBack: jest.fn(),
    getState: () => ({ type: 'stack' }),
  }),
  useRoute: () => ({ params: routeParams }),
}));

jest.mock('../../../data/api/partnersApi', () => ({ partnersApi: { get: jest.fn() } }));
jest.mock('../../../data/api/walletApi', () => ({ walletApi: { getMyWallet: jest.fn() } }));
jest.mock('../../../data/api/purchaseIntentApi', () => ({ purchaseIntentApi: { create: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const partnerFixture = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'partner-1',
  displayName: 'Verified Shop',
  category: 'retail',
  bonusAccrualRateBps: 500,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
});

let activeClient: QueryClient | undefined;
let activeUnmount: (() => void) | undefined;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <CreatePurchaseIntentScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('CreatePurchaseIntentScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '0' });
  });

  afterEach(() => {
    // React Query keeps background refetch/gc timers alive past the test's
    // own assertions unless the client and tree are torn down explicitly,
    // which left Jest's process hanging after a green run instead of
    // exiting cleanly.
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
  });

  it('shows the server-resolved partner name, never the unverified route param', async () => {
    (partnersApi.get as jest.Mock).mockResolvedValue(partnerFixture());
    const { findByText, queryByText } = renderScreen();

    await findByText('Verified Shop');
    expect(queryByText('Unverified Route Placeholder')).toBeNull();
  });

  it('does not render the amount form until the partner has resolved', async () => {
    let resolvePartner: (value: unknown) => void = () => undefined;
    (partnersApi.get as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolvePartner = resolve; }),
    );
    const { queryByText, findByText } = renderScreen();

    expect(queryByText('purchaseIntent.grossAmount')).toBeNull();

    await act(async () => {
      resolvePartner(partnerFixture());
    });

    await findByText('purchaseIntent.grossAmount');
  });

  it('blocks the amount form for an inactive partner', async () => {
    (partnersApi.get as jest.Mock).mockResolvedValue(partnerFixture({ isActive: false }));
    const { findByText, queryByText } = renderScreen();

    await findByText('purchaseIntent.partnerInactive');
    expect(queryByText('purchaseIntent.grossAmount')).toBeNull();
  });

  it('offers a retry instead of the amount form when the partner lookup fails', async () => {
    (partnersApi.get as jest.Mock).mockRejectedValue(new Error('network down'));
    const { findByText, queryByText } = renderScreen();

    await findByText('purchaseIntent.partnerLoadFailed');
    expect(queryByText('purchaseIntent.grossAmount')).toBeNull();
    await waitFor(() => expect(partnersApi.get).toHaveBeenCalledWith('partner-1'));
  });
});
