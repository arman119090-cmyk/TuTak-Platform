import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReferralScreen } from './ReferralScreen';
import { referralApi } from '../../../data/api/referralApi';

/**
 * `TUTAK_UI_UX_MASTER_SPEC_V2.md` §6 / `TUTAK_V2_COMPONENT_INVENTORY.md`
 * "Referral privacy contract": Level 1 shows identities, Levels 2 and 3
 * show a count only — and while no L2/L3 aggregate endpoint exists (see
 * `ReferralScreen.tsx`'s own docblock), they must render a truthful
 * "unavailable" state, never a fabricated `0`.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn(), getState: () => ({ type: 'stack' }) }),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../../data/api/referralApi', () => ({
  referralApi: { getMyCode: jest.fn(), listMyInvites: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ReferralScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ReferralScreen — three-level privacy boundary', () => {
  beforeEach(() => {
    (referralApi.getMyCode as jest.Mock).mockResolvedValue({
      code: 'TUTAK123',
      userId: 'user-1',
      totalInvites: 1,
      totalRewardedInvites: 0,
      createdAt: new Date().toISOString(),
    });
    (referralApi.listMyInvites as jest.Mock).mockResolvedValue([
      {
        id: 'invite-1',
        referrerUserId: 'user-1',
        refereeUserId: 'referee-1',
        // REWARDED with a non-zero amount, deliberately — so the screen's
        // own true, already-computed Level-1 reward total is not itself a
        // "0" that could be confused with the fabricated-zero this suite
        // is actually testing for on Levels 2/3.
        status: 'REWARDED',
        qualifyingAction: 'purchase',
        rewardAmount: '500',
        createdAt: new Date().toISOString(),
        qualifiedAt: new Date().toISOString(),
        referee: { id: 'referee-1', firstName: 'Anna', lastName: 'Petrosyan' },
      },
    ]);
  });

  it('shows the Level-1 invitee by first name + last initial, never the full surname', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Anna P.')).toBeTruthy());
    expect(screen.queryByText(/Petrosyan/)).toBeNull();
  });

  it('never renders a fabricated 0 anywhere while no L2/L3 aggregate endpoint exists', async () => {
    renderScreen();
    // Wait for the real Level-1 data to land (not just the always-static
    // "unavailable" copy) — otherwise this assertion would trivially pass
    // while the invites query is still loading and every count on screen,
    // including Level 1's real one, is a `list ?? []` placeholder zero of
    // its own, which is not what this test is checking for.
    await waitFor(() => expect(screen.getByText('Anna P.')).toBeTruthy());
    expect(screen.getAllByText('referral.levelUnavailableTitle').length).toBe(2);
    expect(screen.queryAllByText('0').length).toBe(0);
  });

  it('renders a truthful "not available yet" state for both Level 2 and Level 3', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getAllByText('referral.levelUnavailableTitle').length).toBe(2),
    );
  });

  it('never renders a phone number, email, or referrer identity anywhere on the screen', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Anna P.')).toBeTruthy());
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.queryByText(/\+\d{6,}/)).toBeNull();
  });

  it('shows the real Level-1 count, not a placeholder, once invites load', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));
  });
});
