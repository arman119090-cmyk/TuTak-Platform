import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PaymentRoute,
  PurchaseIntentStatus,
  TransactionStatus,
  TransactionType,
  type PurchaseIntentDto,
  type TransactionDto,
} from '@tutak/shared-types';
import { TransactionDetailScreen } from './TransactionDetailScreen';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';

/**
 * The opened operation (U05). Amounts come from the row; the purchase and
 * its refunds come from the server, and their absence is shown as
 * "could not load", never as "no refunds".
 */

jest.mock('../../../data/api/purchaseIntentApi', () => ({
  purchaseIntentApi: { get: jest.fn(), refunds: jest.fn() },
}));

let mockTransaction: TransactionDto;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
    canGoBack: () => true,
    getState: () => ({ type: 'stack' }),
  }),
  useRoute: () => ({ params: { transaction: mockTransaction } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function transaction(overrides: Partial<TransactionDto> = {}): TransactionDto {
  return {
    id: 'tx-1',
    userId: 'user-1',
    partnerId: 'partner-1',
    type: TransactionType.PARTNER_PURCHASE,
    status: TransactionStatus.COMPLETED,
    amount: '5000.0000',
    currency: 'AMD' as TransactionDto['currency'],
    bonusAppliedAmount: '500.0000',
    bonusEarnedAmount: '225.0000',
    description: null,
    metadata: null,
    // The brand as it was recorded — not the partner's name today.
    partnerBrand: { partnerId: 'partner-1', displayName: 'Old Name Café', logo: null },
    purchaseIntentId: 'pi-1',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseIntentDto> = {}): PurchaseIntentDto {
  return {
    id: 'pi-1',
    customerId: 'user-1',
    partnerId: 'partner-1',
    partnerBranchId: null,
    status: PurchaseIntentStatus.CONFIRMED,
    grossAmount: '5000.0000',
    bonusAmountRequested: '500.0000',
    ordinaryPaymentRemainder: '4500.0000',
    prepaidAmountApplied: '0',
    refundedAmount: '1000.0000',
    confirmationCode: '0042',
    rejectedByUserId: null,
    cancelledAt: null,
    negotiatedRateBps: 500,
    maxBonusPaymentPercent: 50,
    paymentRoute: PaymentRoute.DIRECT_PARTNER,
    quantity: null,
    quantityUnit: null,
    unitPrice: null,
    contributionRuleKind: null,
    contributionRuleVersion: null,
    merchantApprovedAt: null,
    merchantApprovedByUserId: null,
    partnerBrand: { partnerId: 'partner-1', displayName: 'New Name Café', logo: null },
    confirmedByUserId: 'staff-1',
    rejectionReason: null,
    createdAt: '2026-09-18T09:58:00.000Z',
    expiresAt: '2026-09-18T10:01:00.000Z',
    confirmedAt: '2026-09-18T10:00:00.000Z',
    rejectedAt: null,
    ...overrides,
  };
}

let activeClient: QueryClient | undefined;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TransactionDetailScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TransactionDetailScreen', () => {
  beforeEach(() => {
    mockTransaction = transaction();
    (purchaseIntentApi.get as jest.Mock).mockResolvedValue(purchase());
    (purchaseIntentApi.refunds as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('shows the brand as recorded, the money split exactly, and the status', async () => {
    renderScreen();
    expect(await screen.findByText('Old Name Café')).toBeTruthy();
    expect(screen.queryByText('New Name Café')).toBeNull();
    // 5000 gross − 500 bonus = 4500 in money, computed exactly, not floated.
    expect(screen.getByText(/4[\s,]?500/)).toBeTruthy();
    expect(screen.getByText(/COMPLETED/)).toBeTruthy();
  });

  it('names the route and what has been refunded, from the purchase', async () => {
    renderScreen();
    expect(await screen.findByText(/at the till/i)).toBeTruthy();
    expect(screen.getByText(/1[\s,]?000/)).toBeTruthy();
    expect(screen.getByText('0042')).toBeTruthy();
  });

  it('lists refunds with their reason', async () => {
    (purchaseIntentApi.refunds as jest.Mock).mockResolvedValue([
      {
        id: 'r-1',
        purchaseIntentId: 'pi-1',
        amount: '1000.0000',
        bonusRestored: '100.0000',
        prepaidRestored: '0.0000',
        externalRefundDue: '900.0000',
        externalRefundStatus: 'PENDING_PARTNER',
        externalRefundConfirmedAt: null,
        reason: 'Wrong size',
        createdAt: '2026-09-19T10:00:00.000Z',
      },
    ]);
    renderScreen();
    expect(await screen.findByText('Wrong size')).toBeTruthy();
    expect(screen.queryByText(/no refunds/i)).toBeNull();
  });

  it('says refunds could not be loaded rather than "no refunds"', async () => {
    (purchaseIntentApi.refunds as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/refunds could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/no refunds/i)).toBeNull();
  });

  it('says the purchase could not be loaded rather than inventing a route', async () => {
    (purchaseIntentApi.get as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/purchase behind this operation could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/at the till/i)).toBeNull();
  });

  it('asks the server nothing about a row that is not a purchase', async () => {
    mockTransaction = transaction({
      type: TransactionType.BONUS_ACCRUAL,
      purchaseIntentId: null,
      partnerBrand: null,
    });
    renderScreen();
    expect((await screen.findAllByText(/BONUS_ACCRUAL/)).length).toBeGreaterThan(0);
    expect(purchaseIntentApi.get).not.toHaveBeenCalled();
    expect(screen.queryByText(/refunds/i)).toBeNull();
  });

  it('does not call itself a fiscal receipt', async () => {
    renderScreen();
    expect(await screen.findByText(/not a fiscal receipt/i)).toBeTruthy();
  });
});
