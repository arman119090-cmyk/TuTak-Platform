import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountingPage from './page';
import { accountingApi } from '@/lib/api/financeApi';

/**
 * The page that makes the exports reachable.
 *
 * Two things are asserted beyond "it downloads": that the half-open period
 * is stated on the page, and that an inverted range is refused before the
 * request. An accountant who assumes the end date is included double-counts
 * a day every month, and both sides of their arithmetic will still balance —
 * which is why it would go unnoticed.
 */

jest.mock('@/lib/api/financeApi', () => ({
  accountingApi: { ledgerCsv: jest.fn(), settlementsCsv: jest.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountingPage />
    </QueryClientProvider>,
  );
}

describe('AccountingPage', () => {
  beforeEach(() => {
    (accountingApi.ledgerCsv as jest.Mock).mockResolvedValue(new Blob(['a,b\r\n']));
    (accountingApi.settlementsCsv as jest.Mock).mockResolvedValue(new Blob(['a,b\r\n']));
    // jsdom implements neither.
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    URL.revokeObjectURL = jest.fn();
    jest.clearAllMocks();
  });

  const setPeriod = (from: string, until: string) => {
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: from } });
    fireEvent.change(screen.getByLabelText(/^until$/i), { target: { value: until } });
  };

  it('says plainly that the end date is not included', () => {
    renderPage();
    expect(screen.getByText(/end date is/i).textContent).toMatch(/not.*included/i);
  });

  it('asks for the ledger over the period given', async () => {
    renderPage();
    setPeriod('2026-09-01', '2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: /ledger postings/i }));

    await waitFor(() =>
      expect(accountingApi.ledgerCsv).toHaveBeenCalledWith('2026-09-01', '2026-10-01'),
    );
  });

  it('asks for the settlements file separately', async () => {
    renderPage();
    setPeriod('2026-09-01', '2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: /settlements paid/i }));

    await waitFor(() =>
      expect(accountingApi.settlementsCsv).toHaveBeenCalledWith('2026-09-01', '2026-10-01'),
    );
  });

  it('will not export before a period is chosen', () => {
    renderPage();
    expect((screen.getByRole('button', { name: /ledger postings/i }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('refuses an inverted range before asking the server', () => {
    renderPage();
    setPeriod('2026-10-01', '2026-09-01');
    expect(screen.getByText(/must be after the start date/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /ledger postings/i }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(accountingApi.ledgerCsv).not.toHaveBeenCalled();
  });

  /**
   * The file is fetched with the authenticated client and handed over as a
   * blob. A plain link could not carry a bearer token, and putting one in a
   * query string would write it into logs and history — for a file that is
   * the whole ledger.
   */
  it('releases the object URL rather than holding the file for the tab’s life', async () => {
    renderPage();
    setPeriod('2026-09-01', '2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: /ledger postings/i }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake'));
  });

  it('says so when the export fails rather than failing silently', async () => {
    (accountingApi.ledgerCsv as jest.Mock).mockRejectedValue(new Error('boom'));
    renderPage();
    setPeriod('2026-09-01', '2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: /ledger postings/i }));
    expect(await screen.findByText(/could not be produced/i)).toBeTruthy();
  });
});
