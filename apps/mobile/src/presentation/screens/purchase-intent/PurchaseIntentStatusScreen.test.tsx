import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseIntentStatus, type PurchaseIntentDto } from '@tutak/shared-types';
import { PurchaseIntentStatusScreen } from './PurchaseIntentStatusScreen';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';

/**
 * The customer's own way out of a purchase no cashier has answered yet.
 *
 * Two things are easy to get wrong here and both are money-visible: the
 * action must exist only while the purchase can still be withdrawn, and a
 * cancel that loses the race to the cashier's tap must render what actually
 * happened instead of telling the customer their purchase was cancelled
 * when it was in fact charged.
 */

const mockGoBack = jest.fn();
let mockRouteIntent: PurchaseIntentDto;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    replace: jest.fn(),
    canGoBack: () => true,
    getState: () => ({ type: 'stack' }),
  }),
  useRoute: () => ({ params: { intent: mockRouteIntent } }),
}));

jest.mock('../../../data/api/purchaseIntentApi', () => ({
  purchaseIntentApi: { get: jest.fn(), cancel: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const intentFixture = (overrides: Partial<PurchaseIntentDto> = {}): PurchaseIntentDto => ({
  id: 'pi-1',
  customerId: 'user-1',
  partnerId: 'partner-1',
  partnerBranchId: null,
  status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
  grossAmount: '5000',
  bonusAmountRequested: '500',
  ordinaryPaymentRemainder: '4500',
  negotiatedRateBps: 500,
  maxBonusPaymentPercent: 50,
  partnerBrand: { partnerId: 'partner-1', displayName: 'Verified Shop', logo: null },
  confirmedByUserId: null,
  rejectionReason: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3 * 60_000).toISOString(),
  confirmedAt: null,
  rejectedAt: null,
  cancelledAt: null,
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
        <PurchaseIntentStatusScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

/** Presses the destructive button of the confirmation alert, as a customer would. */
function confirmTheAlert() {
  const alert = Alert.alert as unknown as jest.Mock;
  const buttons = alert.mock.calls.at(-1)?.[2] as Array<{ style?: string; onPress?: () => void }>;
  const destructive = buttons.find((b) => b.style === 'destructive');
  expect(destructive).toBeDefined();
  destructive!.onPress?.();
}

describe('PurchaseIntentStatusScreen — customer cancellation', () => {
  beforeEach(() => {
    mockRouteIntent = intentFixture();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (purchaseIntentApi.get as jest.Mock).mockImplementation(async () => mockRouteIntent);
    (purchaseIntentApi.cancel as jest.Mock).mockReset();
  });

  afterEach(() => {
    // Same teardown reason as CreatePurchaseIntentScreen's: the poll's
    // refetch timer outlives the assertions otherwise.
    activeUnmount?.();
    activeUnmount = undefined;
    activeClient?.clear();
    activeClient = undefined;
    jest.restoreAllMocks();
  });

  it('offers the cancel action while the purchase is still awaiting confirmation', async () => {
    const { findByText } = renderScreen();
    await findByText('purchaseIntent.cancel');
  });

  it('asks before cancelling — one tap never withdraws a purchase on its own', async () => {
    const { findByText } = renderScreen();
    fireEvent.press(await findByText('purchaseIntent.cancel'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(purchaseIntentApi.cancel).not.toHaveBeenCalled();
  });

  it('renders the cancelled state once the server confirms the withdrawal', async () => {
    const cancelled = intentFixture({
      status: PurchaseIntentStatus.CANCELLED,
      cancelledAt: new Date().toISOString(),
    });
    (purchaseIntentApi.cancel as jest.Mock).mockResolvedValue(cancelled);

    const { findByText } = renderScreen();
    fireEvent.press(await findByText('purchaseIntent.cancel'));
    await act(async () => confirmTheAlert());

    await waitFor(() => expect(purchaseIntentApi.cancel).toHaveBeenCalledWith('pi-1'));
    await findByText('purchaseIntent.cancelled');
  });

  it('shows what actually happened when the cashier got there first, not a cancellation', async () => {
    const confirmed = intentFixture({
      status: PurchaseIntentStatus.CONFIRMED,
      confirmedByUserId: 'cashier-1',
      confirmedAt: new Date().toISOString(),
    });
    // The shape axios raises for the server's 400 on a purchase that has
    // already left AWAITING_CONFIRMATION.
    (purchaseIntentApi.cancel as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { status: 400, data: { message: 'This purchase can no longer be cancelled' } },
      }),
    );
    (purchaseIntentApi.get as jest.Mock).mockResolvedValue(confirmed);

    const { findByText, queryByText } = renderScreen();
    fireEvent.press(await findByText('purchaseIntent.cancel'));
    await act(async () => confirmTheAlert());

    await findByText('purchaseIntent.confirmed');
    expect(queryByText('purchaseIntent.cancelled')).toBeNull();
  });

  it('offers no cancel action on a purchase that is already resolved', async () => {
    mockRouteIntent = intentFixture({
      status: PurchaseIntentStatus.CONFIRMED,
      confirmedAt: new Date().toISOString(),
    });
    const { findByText, queryByText } = renderScreen();

    await findByText('purchaseIntent.confirmed');
    expect(queryByText('purchaseIntent.cancel')).toBeNull();
  });
});
