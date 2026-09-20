import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatePurchaseIntentScreen } from './CreatePurchaseIntentScreen';
import { partnersApi } from '../../../data/api/partnersApi';
import { walletApi } from '../../../data/api/walletApi';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';

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

  /**
   * U07 — what the customer is told while typing, checked exactly.
   */
  describe('amounts and the bonus ceiling', () => {
    beforeEach(() => {
      (partnersApi.get as jest.Mock).mockResolvedValue(
        partnerFixture({ maxBonusPaymentPercent: 50 }),
      );
    });

    it('says the balance is unavailable, never zero, while the wallet has not answered', async () => {
      (walletApi.getMyWallet as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const { findByText, queryByText } = renderScreen();
      await findByText('purchaseIntent.balanceLoading');
      expect(queryByText(/qr\.availableToSpend/)).toBeNull();
    });

    it('says the balance is unavailable, with a retry, when the wallet request fails', async () => {
      (walletApi.getMyWallet as jest.Mock).mockRejectedValue(new Error('network'));
      const { findByText, queryByText } = renderScreen();
      await findByText('purchaseIntent.balanceUnavailable');
      expect(queryByText(/qr\.availableToSpend/)).toBeNull();
      expect(await findByText('common.retry')).toBeTruthy();
    });

    it('refuses a bonus above the purchase amount instead of showing zero to pay', async () => {
      (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '5000' });
      const { findByText, getByPlaceholderText, queryByText } = renderScreen();
      await findByText('purchaseIntent.grossAmount');
      const [grossField, bonusField] = screen.getAllByPlaceholderText('0');
      fireEvent.changeText(grossField!, '1000');
      fireEvent.changeText(bonusField!, '1200');
      expect(await findByText('purchaseIntent.bonusOverGross')).toBeTruthy();
      expect(queryByText('purchaseIntent.youPay')).toBeNull();
      void getByPlaceholderText;
    });

    it("refuses a bonus above the partner's ceiling, naming the ceiling", async () => {
      (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '5000' });
      const { findByText } = renderScreen();
      await findByText('purchaseIntent.grossAmount');
      const [grossField, bonusField] = screen.getAllByPlaceholderText('0');
      fireEvent.changeText(grossField!, '1000');
      fireEvent.changeText(bonusField!, '600');
      expect(await findByText('purchaseIntent.bonusOverLimit')).toBeTruthy();
    });

    it('refuses a bonus above the balance', async () => {
      (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '100' });
      const { findByText } = renderScreen();
      await findByText('purchaseIntent.grossAmount');
      const [grossField, bonusField] = screen.getAllByPlaceholderText('0');
      fireEvent.changeText(grossField!, '1000');
      fireEvent.changeText(bonusField!, '200');
      expect(await findByText('purchaseIntent.bonusOverBalance')).toBeTruthy();
    });

    it('previews the remainder exactly, with four-decimal precision kept', async () => {
      (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '5000' });
      const { findByText } = renderScreen();
      await findByText('purchaseIntent.grossAmount');
      const [grossField, bonusField] = screen.getAllByPlaceholderText('0');
      fireEvent.changeText(grossField!, '1000.0003');
      fireEvent.changeText(bonusField!, '0.0001');
      expect(await findByText('purchaseIntent.youPay')).toBeTruthy();
      // 1000.0002 formatted for display — whatever the formatter does with
      // the decimals, it was handed the exact string, not a float.
      expect(screen.getByText(/1\D?000/)).toBeTruthy();
    });

    it('sends the amounts as typed and lets the server decide', async () => {
      (walletApi.getMyWallet as jest.Mock).mockResolvedValue({ availableBonus: '5000' });
      (purchaseIntentApi.create as jest.Mock).mockResolvedValue({ id: 'pi-1' });
      const { findByText } = renderScreen();
      await findByText('purchaseIntent.grossAmount');
      const [grossField, bonusField] = screen.getAllByPlaceholderText('0');
      fireEvent.changeText(grossField!, '1000');
      fireEvent.changeText(bonusField!, '400');
      fireEvent.press(screen.getByText('purchaseIntent.submit'));
      await waitFor(() =>
        expect(purchaseIntentApi.create).toHaveBeenCalledWith(
          expect.objectContaining({ grossAmount: '1000', bonusAmountRequested: '400' }),
        ),
      );
    });
  });
});
