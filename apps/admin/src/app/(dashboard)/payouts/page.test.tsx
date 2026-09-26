import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role } from '@tutak/shared-types';
import PayoutsPage from './page';
import { financeApi, type Payout, type PartnerCollection } from '@/lib/api/financeApi';
import { partnersApi } from '@/lib/api/partnersApi';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The payouts screen: what a partner is owed, the retired payout engine's
 * history, and collections of what a partner owes TuTak.
 *
 * Requesting and confirming payouts left this screen on 26.09.2026 with the
 * engine behind them (a second path out of the partner's payable that the
 * settlement engine could not see — the same earnings could be paid twice).
 * What is pinned here: the history is shown read-only with no way to act on
 * it, the operator is pointed at settlements, and the collection flow — the
 * other direction of money, still recorded here — keeps its retry-safe key
 * and its two-person rule.
 */

jest.mock('@/lib/api/financeApi', () => ({
  financeApi: {
    partnerBalance: jest.fn(),
    partnerPayouts: jest.fn(),
    partnerCollections: jest.fn(),
    recordCollection: jest.fn(),
    confirmCollection: jest.fn(),
  },
}));

jest.mock('@/lib/api/partnersApi', () => ({
  partnersApi: { list: jest.fn() },
}));

const mockedFinance = financeApi as jest.Mocked<typeof financeApi>;
const mockedPartners = partnersApi as jest.Mocked<typeof partnersApi>;

const requested: Payout = {
  id: 'payout-1',
  partnerId: 'partner-1',
  amount: '5000.00',
  status: 'REQUESTED',
  bankReference: null,
  failureReason: null,
  createdAt: '2026-08-09T10:00:00.000Z',
  completedAt: null,
  requestedByUserId: 'someone-else',
  confirmedByUserId: null,
  requestedByName: 'Narek',
  confirmedByName: null,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PayoutsPage />
    </QueryClientProvider>,
  );
}

/**
 * Lets anything the click started actually run.
 *
 * A mutation does not call its `mutationFn` synchronously, so asserting
 * "this was never sent" immediately after a click passes whether or not the
 * bug is present. The first version of the two dismissal tests below did
 * exactly that, and went on passing when the old `?? 'unknown'` behaviour was
 * put back to check they had teeth. They did not.
 */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/** Chooses the partner, which is what makes the rest of the screen appear. */
async function selectPartner() {
  // Wait for the option itself, not just the select: firing a change for a
  // value that has not rendered yet leaves the select on its placeholder and
  // the rest of the screen never appears.
  await screen.findByRole('option', { name: 'Coffee Bar' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'partner-1' } });
  await screen.findByText('requested');
}

describe('PayoutsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The buttons are hidden below SUPER_ADMIN, which is the real control's
    // courtesy half — the server enforces it regardless.
    useAuthStore.setState({
      user: {
        id: 'me',
        firstName: 'Ani',
        lastName: 'Sargsyan',
        roles: [Role.SUPER_ADMIN],
      } as never,
    });
    mockedPartners.list.mockResolvedValue([
      { id: 'partner-1', displayName: 'Coffee Bar' } as never,
    ]);
    mockedFinance.partnerBalance.mockResolvedValue({ availableBalance: '9000.00' });
    mockedFinance.partnerPayouts.mockResolvedValue([requested]);
    mockedFinance.partnerCollections.mockResolvedValue([]);
    mockedFinance.recordCollection.mockResolvedValue({
      collectionId: 'collection-1',
      status: 'PENDING',
    } as never);
    mockedFinance.confirmCollection.mockResolvedValue({ status: 'CONFIRMED' } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the legacy history read-only: no request form, no confirm or fail buttons', async () => {
    renderPage();
    await selectPartner();

    // The row is there, with who asked for it…
    expect(screen.getByText('Narek')).toBeTruthy();
    expect(screen.getByText('5,000.00')).toBeTruthy();
    // …and nothing to press. Even a SUPER_ADMIN cannot act on it from here:
    // the API routes behind those buttons are gone.
    expect(screen.queryByText('Request payout')).toBeNull();
    expect(screen.queryByPlaceholderText('0.00')).toBeNull();
    expect(screen.queryByRole('button', { name: /confirm the 5,000 payout/i })).toBeNull();
    expect(screen.queryByText('Mark failed')).toBeNull();
    expect(screen.queryByText('Confirm')).toBeNull();
  });

  it('points the operator at settlements as the way to pay a partner', async () => {
    renderPage();
    await selectPartner();

    expect(await screen.findByText(/to pay this partner, draft a settlement/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Settlements' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settlements');
  });

  it('shows what the partner is owed', async () => {
    renderPage();
    await selectPartner();

    expect(await screen.findByText('9,000.00 AMD')).toBeTruthy();
  });

  // ── Collections: the other settlement direction ──────────────────────

  describe('collections', () => {
    it("has nothing to collect when the balance is in the partner's favor", async () => {
      renderPage();
      await selectPartner();

      expect(
        await screen.findByText(/does not currently owe TuTak anything/i),
      ).toBeTruthy();
      expect(screen.queryByText('Record collection')).toBeNull();
    });

    it('records a collection with the amount and reference typed in', async () => {
      mockedFinance.partnerBalance.mockResolvedValue({ availableBalance: '-1200.00' });

      renderPage();
      await selectPartner();
      await screen.findByText(/owed to tutak/i);

      // Two amount fields are on screen once a partner in the red is
      // selected — the payout request form and this one — so the plain
      // singular query would be ambiguous.
      const amountFields = screen.getAllByPlaceholderText('0.00');
      fireEvent.change(amountFields[amountFields.length - 1]!, { target: { value: '1200' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. SWIFT-99120'), {
        target: { value: 'SWIFT-COLLECT-1' },
      });
      fireEvent.change(screen.getByPlaceholderText("the statement's own transaction id"), {
        target: { value: 'TXN-COLLECT-1' },
      });
      fireEvent.click(screen.getByText('Record collection'));

      await waitFor(() =>
        expect(mockedFinance.recordCollection).toHaveBeenCalledWith(
          'partner-1',
          '1200',
          'SWIFT-COLLECT-1',
          'TXN-COLLECT-1',
          expect.any(String),
        ),
      );
    });

    it('retries a timed-out collection with the key the first attempt used', async () => {
      mockedFinance.partnerBalance.mockResolvedValue({ availableBalance: '-1200.00' });
      mockedFinance.recordCollection
        .mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))
        .mockResolvedValueOnce({ collectionId: 'collection-2', status: 'PENDING' } as never);

      renderPage();
      await selectPartner();
      await screen.findByText(/owed to tutak/i);

      // Two amount fields are on screen once a partner in the red is
      // selected — the payout request form and this one — so the plain
      // singular query would be ambiguous.
      const amountFields = screen.getAllByPlaceholderText('0.00');
      fireEvent.change(amountFields[amountFields.length - 1]!, { target: { value: '1200' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. SWIFT-99120'), {
        target: { value: 'SWIFT-COLLECT-2' },
      });
      fireEvent.change(screen.getByPlaceholderText("the statement's own transaction id"), {
        target: { value: 'TXN-COLLECT-2' },
      });
      fireEvent.click(screen.getByText('Record collection'));
      await screen.findByText('timeout of 15000ms exceeded');

      fireEvent.click(screen.getByText('Record collection'));
      await waitFor(() => expect(mockedFinance.recordCollection).toHaveBeenCalledTimes(2));

      const [, , , , firstKey] = mockedFinance.recordCollection.mock.calls[0]!;
      const [, , , , secondKey] = mockedFinance.recordCollection.mock.calls[1]!;

      expect(firstKey).toBeTruthy();
      expect(secondKey).toBe(firstKey);
    });

    // ── Confirming a collection: the checker half of the two-person rule ──

    const pendingBySomeoneElse: PartnerCollection = {
      id: 'collection-pending-1',
      partnerId: 'partner-1',
      amount: '1200.00',
      status: 'PENDING',
      bankReference: 'SWIFT-COLLECT-3',
      bankTransactionId: 'TXN-COLLECT-3',
      createdAt: '2026-08-24T10:00:00.000Z',
      recordedByUserId: 'someone-else',
      recordedByName: 'Narek',
      confirmedByUserId: null,
      confirmedByName: null,
    };

    // `selectPartner()` waits for the legacy payout row; these two wait for
    // the collection row instead, which is what they are about.
    const selectPartnerForCollections = async () => {
      await screen.findByRole('option', { name: 'Coffee Bar' });
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'partner-1' } });
      await screen.findByText('pending');
    };

    it('shows a PENDING collection recorded by someone else with a working Confirm button', async () => {
      mockedFinance.partnerCollections.mockResolvedValue([pendingBySomeoneElse]);

      renderPage();
      await selectPartnerForCollections();

      fireEvent.click(screen.getByRole('button', { name: /confirm the 1,200 collection/i }));

      await waitFor(() =>
        expect(mockedFinance.confirmCollection).toHaveBeenCalledWith('collection-pending-1'),
      );
    });

    it('disables confirmation and explains why for a collection the current admin recorded themselves', async () => {
      mockedFinance.partnerCollections.mockResolvedValue([
        { ...pendingBySomeoneElse, recordedByUserId: 'me', recordedByName: 'Ani' },
      ]);

      renderPage();
      await selectPartnerForCollections();

      expect(await screen.findByText(/you recorded this/i)).toBeTruthy();
      const confirmButton = screen.getByRole('button', {
        name: /confirm the 1,200 collection/i,
      }) as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);

      fireEvent.click(confirmButton);
      await settle();
      expect(mockedFinance.confirmCollection).not.toHaveBeenCalled();
    });
  });
});
