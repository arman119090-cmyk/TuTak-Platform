import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionStatus, TransactionType, type TransactionDto } from '@tutak/shared-types';
import { TransactionHistoryScreen } from './TransactionHistoryScreen';
import { transactionsApi } from '../../../data/api/transactionsApi';

/**
 * The history, page by page (U04), with the status always visible (U05).
 *
 * The property under test: no page that already rendered is ever taken
 * away by a later failure, and a missing answer is never shown as "no
 * transactions yet".
 */

jest.mock('../../../data/api/transactionsApi', () => ({
  transactionsApi: { myHistory: jest.fn() },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    canGoBack: () => true,
    getState: () => ({ type: 'stack' }),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function tx(id: string, overrides: Partial<TransactionDto> = {}): TransactionDto {
  return {
    id,
    userId: 'user-1',
    partnerId: 'partner-1',
    type: TransactionType.PARTNER_PURCHASE,
    status: TransactionStatus.COMPLETED,
    amount: '5000.0000',
    currency: 'AMD' as TransactionDto['currency'],
    bonusAppliedAmount: '0.0000',
    bonusEarnedAmount: '250.0000',
    description: 'Purchase at Coffee Corner',
    metadata: null,
    partnerBrand: { partnerId: 'partner-1', displayName: 'Coffee Corner', logo: null },
    purchaseIntentId: `pi-${id}`,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
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
        <TransactionHistoryScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TransactionHistoryScreen', () => {
  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('shows the status even when bonus was applied', async () => {
    (transactionsApi.myHistory as jest.Mock).mockResolvedValue({
      items: [tx('a', { bonusAppliedAmount: '500.0000' })],
      nextCursor: null,
    });
    renderScreen();
    expect(await screen.findByText(/COMPLETED/)).toBeTruthy();
    expect(screen.getByText(/qr\.bonusAppliedShort/)).toBeTruthy();
  });

  it('walks three pages without repeating or losing a row', async () => {
    (transactionsApi.myHistory as jest.Mock).mockImplementation((cursor?: string) => {
      if (!cursor) return Promise.resolve({ items: [tx('1'), tx('2')], nextCursor: '2' });
      if (cursor === '2') return Promise.resolve({ items: [tx('3'), tx('4')], nextCursor: '4' });
      return Promise.resolve({ items: [tx('5')], nextCursor: null });
    });
    const { getByText } = renderScreen();
    await screen.findByText(/show earlier operations/i);
    fireEvent.press(getByText(/show earlier operations/i));
    await waitFor(() => expect(transactionsApi.myHistory).toHaveBeenCalledWith('2'));
    await screen.findByText(/show earlier operations/i);
    fireEvent.press(getByText(/show earlier operations/i));
    await waitFor(() => expect(transactionsApi.myHistory).toHaveBeenCalledWith('4'));
    expect(await screen.findByText(/that's everything/i)).toBeTruthy();

    // Five rows, each exactly once.
    expect(screen.getAllByText('Coffee Corner')).toHaveLength(5);
    expect(screen.queryByText(/show earlier operations/i)).toBeNull();
  });

  it('keeps the loaded pages when the next one fails, and offers to retry', async () => {
    (transactionsApi.myHistory as jest.Mock)
      .mockResolvedValueOnce({ items: [tx('1'), tx('2')], nextCursor: '2' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [tx('3')], nextCursor: null });
    const { getByText } = renderScreen();
    await screen.findByText(/show earlier operations/i);
    fireEvent.press(getByText(/show earlier operations/i));

    expect(await screen.findByText(/next page could not be loaded/i)).toBeTruthy();
    expect(screen.getAllByText('Coffee Corner')).toHaveLength(2);
    expect(screen.queryByText(/wallet\.noTransactions/)).toBeNull();

    fireEvent.press(getByText(/common\.retry/));
    await waitFor(() => expect(transactionsApi.myHistory).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByText('Coffee Corner')).toHaveLength(3));
    expect(screen.queryByText(/next page could not be loaded/i)).toBeNull();
  });

  it('shows an error, never "no transactions yet", when the first page fails', async () => {
    (transactionsApi.myHistory as jest.Mock).mockRejectedValue(new Error('network'));
    renderScreen();
    expect(await screen.findByText(/common\.error/)).toBeTruthy();
    expect(screen.queryByText(/wallet\.noTransactions/)).toBeNull();
    expect(screen.getByText(/common\.retry/)).toBeTruthy();
  });

  it('keeps rows on screen, marked stale, when a refresh fails', async () => {
    (transactionsApi.myHistory as jest.Mock)
      .mockResolvedValueOnce({ items: [tx('1')], nextCursor: null })
      .mockRejectedValueOnce(new Error('network'));
    renderScreen();
    await screen.findByText('Coffee Corner');
    await activeClient!.refetchQueries({ queryKey: ['transactions', 'history'] });
    expect(await screen.findByText(/connection lost/i)).toBeTruthy();
    expect(screen.getByText('Coffee Corner')).toBeTruthy();
  });

  it('opens the operation with the row it was tapped on', async () => {
    (transactionsApi.myHistory as jest.Mock).mockResolvedValue({
      items: [tx('a')],
      nextCursor: null,
    });
    const { getByText } = renderScreen();
    fireEvent.press(await screen.findByText('Coffee Corner'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', {
      transaction: expect.objectContaining({ id: 'a' }),
    });
    void getByText;
  });
});
