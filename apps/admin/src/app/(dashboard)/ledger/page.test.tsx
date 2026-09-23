import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LedgerPage from './page';

jest.mock('@/lib/api/financeApi', () => ({
  financeApi: {
    outstandingReceivable: jest.fn().mockResolvedValue({ outstandingReceivable: '0' }),
    acquirerSettlements: jest.fn().mockResolvedValue([]),
    ledgerAccounts: jest.fn().mockResolvedValue([]),
    ledgerAccount: jest.fn(),
    recordAcquirerSettlement: jest.fn(),
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LedgerPage />
    </QueryClientProvider>,
  );
}

describe('LedgerPage remittance amount', () => {
  it('reads a decimal comma as the decimal point instead of dropping it', () => {
    renderPage();
    const amount = screen.getByPlaceholderText('0') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '1500,50' } });
    // Not 150050 — a remittance a hundred times larger than the one received.
    expect(amount.value).toBe('1500.50');
  });

  it('defaults the landing date to today on this computer’s calendar', () => {
    renderPage();
    const today = new Intl.DateTimeFormat('en-CA').format(new Date());
    expect(screen.getByDisplayValue(today)).toBeTruthy();
  });
});
