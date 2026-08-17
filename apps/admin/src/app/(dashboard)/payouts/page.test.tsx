import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role } from '@tutak/shared-types';
import PayoutsPage from './page';
import { financeApi, type Payout } from '@/lib/api/financeApi';
import { partnersApi } from '@/lib/api/partnersApi';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The payouts screen: the least reversible thing this platform does.
 *
 * Two behaviours are pinned here. One is the retry that must not pay twice,
 * for the reason `refunds/page.test.tsx` sets out at length. The other is
 * narrower and was worse: confirming a payout asked for a bank reference with
 * `window.prompt(...) ?? 'unknown'`, so pressing Escape confirmed the
 * transfer anyway and recorded the reference as the literal word "unknown".
 *
 * Confirmation is the second half of the two-person rule. An operator who
 * dismisses the dialog has said no in the plainest way available to them, and
 * the screen was reading it as yes.
 */

jest.mock('@/lib/api/financeApi', () => ({
  financeApi: {
    partnerBalance: jest.fn(),
    partnerPayouts: jest.fn(),
    requestPayout: jest.fn(),
    confirmPayout: jest.fn(),
    failPayout: jest.fn(),
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
  await screen.findByText('Confirm');
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
    mockedFinance.confirmPayout.mockResolvedValue(undefined);
    mockedFinance.failPayout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not confirm a payout when the reference dialog is dismissed', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    renderPage();
    await selectPartner();
    fireEvent.click(screen.getByText('Confirm'));

    expect(window.prompt).toHaveBeenCalled();
    await settle();
    expect(mockedFinance.confirmPayout).not.toHaveBeenCalled();
  });

  it('does not mark a payout failed when the reason dialog is dismissed', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    renderPage();
    await selectPartner();
    fireEvent.click(screen.getByText('Mark failed'));

    await settle();
    expect(mockedFinance.failPayout).not.toHaveBeenCalled();
  });

  it('refuses a blank bank reference and says why', async () => {
    // Pressing OK on an empty box is not the same as cancelling, so it earns
    // an explanation rather than silence.
    jest.spyOn(window, 'prompt').mockReturnValue('   ');

    renderPage();
    await selectPartner();
    fireEvent.click(screen.getByText('Confirm'));

    await settle();
    expect(mockedFinance.confirmPayout).not.toHaveBeenCalled();
    expect(await screen.findByText(/bank reference is required/i)).toBeTruthy();
  });

  it('confirms with the reference the operator typed, trimmed', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('  SWIFT-99120  ');

    renderPage();
    await selectPartner();
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() =>
      expect(mockedFinance.confirmPayout).toHaveBeenCalledWith('payout-1', 'SWIFT-99120'),
    );
  });

  it('does not fire a second confirm request while the first is still in flight', async () => {
    // Independent audit, GitHub issue #28: unlike every other money-moving
    // control on this screen, Confirm/Mark-failed had no `isPending` guard —
    // a double-click (or an impatient retry before the first request even
    // returned) could fire a second POST to `/payouts/:id/confirm`. The
    // dialog itself is a one-time synchronous gate; it does nothing to stop
    // a second click once the request it started is merely slow.
    jest.spyOn(window, 'prompt').mockReturnValue('SWIFT-1');
    let resolveConfirm: (() => void) | undefined;
    mockedFinance.confirmPayout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = () => resolve();
        }),
    );

    renderPage();
    await selectPartner();
    fireEvent.click(screen.getByText('Confirm'));
    await settle();
    expect(mockedFinance.confirmPayout).toHaveBeenCalledTimes(1);

    // The button must now be disabled while the request is still in flight.
    const button = await screen.findByText('Confirming…');
    fireEvent.click(button);
    await settle();
    expect(mockedFinance.confirmPayout).toHaveBeenCalledTimes(1);

    resolveConfirm?.();
    await settle();
  });

  it('retries a timed-out payout request with the key the first attempt used', async () => {
    mockedFinance.requestPayout
      .mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))
      .mockResolvedValueOnce({ payoutId: 'payout-2' });

    renderPage();
    await selectPartner();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1500' } });
    fireEvent.click(screen.getByText('Request payout'));
    await screen.findByText('timeout of 15000ms exceeded');

    fireEvent.click(screen.getByText('Request payout'));
    await waitFor(() => expect(mockedFinance.requestPayout).toHaveBeenCalledTimes(2));

    const [, , firstKey] = mockedFinance.requestPayout.mock.calls[0]!;
    const [, , secondKey] = mockedFinance.requestPayout.mock.calls[1]!;

    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });
});
