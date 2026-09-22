import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PartnerEmployeeCardDto } from '@tutak/shared-types';
import { EmployeeCard } from './EmployeeCard';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * The screen that turns `EMP-007` into a person, and the three answers it
 * has to keep apart.
 *
 * A card is an answer. A refusal is *not* "no such employee" — the server
 * answers "this code does not exist" and "this code is not yours to resolve"
 * identically on purpose, so a screen claiming to know which one it got
 * would be inventing the distinction the API deliberately hides. And a
 * failure to load is neither: an empty card where the network broke tells a
 * partner their employee has no branches.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: { employeeCard: jest.fn() },
}));

const api = partnerApi as jest.Mocked<typeof partnerApi>;

const cardFixture = (overrides: Partial<PartnerEmployeeCardDto> = {}): PartnerEmployeeCardDto => ({
  code: 'EMP-007',
  firstName: 'Արամ',
  lastName: 'Հակոբյան',
  assignments: [
    {
      branchId: 'branch-1',
      branchName: 'North',
      branchAddress: 'Komitas 1',
      role: 'STAFF',
      isActive: true,
      assignedAt: '2026-03-01T10:00:00.000Z',
      deactivatedAt: null,
    },
  ],
  roles: [{ role: 'PARTNER_STAFF', allBranches: false }],
  ...overrides,
});

const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { message: 'nope' } },
  });

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeCard partnerId="partner-1" code="EMP-007" />
    </QueryClientProvider>,
  );
}

describe('EmployeeCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('names the person and their branch', async () => {
    api.employeeCard.mockResolvedValue(cardFixture());

    renderCard();

    expect(await screen.findByText('Արամ Հակոբյան')).toBeTruthy();
    expect(screen.getByText('EMP-007')).toBeTruthy();
    expect(screen.getByText('North')).toBeTruthy();
    expect(screen.getByText('Working here')).toBeTruthy();
  });

  it('shows an ended posting with the date it ended', async () => {
    api.employeeCard.mockResolvedValue(
      cardFixture({
        assignments: [
          {
            branchId: 'branch-1',
            branchName: 'North',
            branchAddress: 'Komitas 1',
            role: 'STAFF',
            isActive: false,
            assignedAt: '2026-03-01T10:00:00.000Z',
            deactivatedAt: '2026-06-15T09:00:00.000Z',
          },
        ],
      }),
    );

    renderCard();

    expect(await screen.findByText('Ended 2026-06-15')).toBeTruthy();
  });

  it('explains an owner who is posted nowhere instead of showing an empty table', async () => {
    api.employeeCard.mockResolvedValue(
      cardFixture({
        assignments: [],
        roles: [{ role: 'PARTNER_OWNER', allBranches: true }],
      }),
    );

    renderCard();

    expect(await screen.findByText(/Not posted to a specific branch/)).toBeTruthy();
    expect(screen.queryByText('Branch')).toBeNull();
  });

  /**
   * The wording matters more than the fact of a message: the API refuses to
   * say whether the code exists, so the screen must not say it either.
   */
  it('does not claim a refused code is nonexistent', async () => {
    api.employeeCard.mockRejectedValue(httpError(404));

    renderCard();

    // By text rather than by role: the loading notice is a `status` too, and
    // `findByRole('status')` matches it on the first tick.
    const notice = await screen.findByText(/does not resolve/i);
    // Both possibilities, never one of them as a fact: the server answers
    // "no such code" and "not yours to resolve" identically on purpose, so a
    // screen that picked either would be inventing what it was not told.
    expect(notice.textContent).toMatch(/no such employee code exists/i);
    expect(notice.textContent).toMatch(/belongs to a branch you are not assigned to/i);
    expect(notice.textContent).toMatch(/\bor\b/i);
  });

  it('tells a failure to load apart from a refusal', async () => {
    api.employeeCard.mockRejectedValue(httpError(500));

    renderCard();

    // Two attempts before giving up, so this waits longer than a refusal does.
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 });
    expect(alert.textContent).toMatch(/Could not look up this code/i);
    // And offers the way out that a refusal does not have.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('never asks the server again about a refusal', async () => {
    api.employeeCard.mockRejectedValue(httpError(404));

    renderCard();

    await screen.findByText(/does not resolve/i);
    await waitFor(() => expect(api.employeeCard).toHaveBeenCalledTimes(1));
  });
});
