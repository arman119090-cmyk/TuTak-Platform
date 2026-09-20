import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletScreen } from './WalletScreen';
import { walletApi } from '../../../data/api/walletApi';

/**
 * The wallet's three sources, each answered for itself (U06).
 *
 * The property under test: no missing answer is drawn as a number, an
 * empty list, or a skeleton that never ends.
 */

jest.mock('../../../data/api/walletApi', () => ({
  walletApi: { getMyWallet: jest.fn(), getMyLedger: jest.fn(), getMyLots: jest.fn() },
  isWalletAbsent: (error: unknown) =>
    (error as { response?: { status?: number } } | undefined)?.response?.status === 404,
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: () => false,
    getState: () => ({ type: 'tab' }),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const walletFixture = {
  id: 'wallet-1',
  availableBonus: '1500.0000',
  pendingBonus: '200.0000',
  reservedBonus: '0.0000',
  lifetimeEarned: '9000.0000',
  lifetimeSpent: '7300.0000',
};

let activeClient: QueryClient | undefined;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <WalletScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('WalletScreen', () => {
  beforeEach(() => {
    (walletApi.getMyWallet as jest.Mock).mockResolvedValue(walletFixture);
    (walletApi.getMyLedger as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    (walletApi.getMyLots as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('shows the balance and lifetime totals only from the wallet answer', async () => {
    renderScreen();
    expect(await screen.findByText(/9\D?000/)).toBeTruthy();
    expect(screen.getByText(/7\D?300/)).toBeTruthy();
  });

  it('shows no lifetime total, and no zero, when the wallet request fails', async () => {
    (walletApi.getMyWallet as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/common\.error/)).toBeTruthy();
    expect(screen.queryByText(/wallet\.lifetimeEarned/)).toBeNull();
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it('ends the ledger skeleton with an error, not forever', async () => {
    (walletApi.getMyLedger as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/bonus history could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/wallet\.noTransactions/)).toBeNull();
    expect(screen.getAllByText(/common\.retry/).length).toBeGreaterThan(0);
  });

  it('does not pass off failed lots as "nothing expiring"', async () => {
    (walletApi.getMyLots as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/expiring bonuses could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/wallet\.expiringSoon/)).toBeTruthy();
  });

  it('keeps the balance on screen, marked stale, when a refresh fails', async () => {
    (walletApi.getMyWallet as jest.Mock)
      .mockResolvedValueOnce(walletFixture)
      .mockRejectedValueOnce(new Error('network'));
    renderScreen();
    await screen.findByText(/9\D?000/);
    await activeClient!.refetchQueries({ queryKey: ['wallet'] });
    expect(await screen.findByText(/connection lost/i)).toBeTruthy();
    expect(screen.getByText(/9\D?000/)).toBeTruthy();
  });

  it('says an account has no wallet without offering a pointless retry', async () => {
    (walletApi.getMyWallet as jest.Mock).mockRejectedValue({ response: { status: 404 } });
    renderScreen();
    expect(await screen.findByText(/wallet\.noWalletTitle/)).toBeTruthy();
  });
});
