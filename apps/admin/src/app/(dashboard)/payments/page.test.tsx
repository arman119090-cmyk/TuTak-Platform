import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentsPage from './page';
import { pspApi, treasuryApi } from '@/lib/api/financeApi';

/**
 * The payments screen is the one an operator opens to ask "is anything stuck?".
 * A failed poll used to answer "Nothing unresolved" — the all-clear, over an
 * error — and quietly dropped the treasury position and the dead letters.
 */

jest.mock('@/lib/api/financeApi', () => ({
  pspApi: { unresolved: jest.fn(), deadLettered: jest.fn() },
  treasuryApi: { position: jest.fn() },
}));

const mockedPsp = pspApi as jest.Mocked<typeof pspApi>;
const mockedTreasury = treasuryApi as jest.Mocked<typeof treasuryApi>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PaymentsPage />
    </QueryClientProvider>,
  );
}

describe('PaymentsPage', () => {
  beforeEach(() => jest.resetAllMocks());

  it('does not give the all-clear when the unresolved list failed to load', async () => {
    mockedPsp.unresolved.mockRejectedValue(new Error('500'));
    mockedPsp.deadLettered.mockRejectedValue(new Error('500'));
    mockedTreasury.position.mockRejectedValue(new Error('500'));
    renderPage();

    expect(await screen.findByText('Could not load unresolved payments')).toBeTruthy();
    expect(await screen.findByText('Could not load failed provider callbacks')).toBeTruthy();
    expect(await screen.findByText('Could not load the treasury position')).toBeTruthy();
    expect(screen.queryByText('Nothing unresolved')).toBeNull();
  });

  it('gives the all-clear only when the list loaded empty', async () => {
    mockedPsp.unresolved.mockResolvedValue([]);
    mockedPsp.deadLettered.mockResolvedValue([]);
    mockedTreasury.position.mockResolvedValue({
      platformBank: '0',
      unsettledAcquirerAmount: '0',
      partnerPayable: '0',
      safeToPay: '0',
      paymentsWithUnknownFee: 0,
    } as never);
    renderPage();

    expect(await screen.findByText('Nothing unresolved')).toBeTruthy();
  });
});
