import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PartnersScreen } from './PartnersScreen';
import { Skeleton } from '../../components/Skeleton';
import { partnersApi } from '../../../data/api/partnersApi';
import { evApi } from '../../../data/api/evApi';

/**
 * The map/explore redesign (2026-08-23) touches this screen's loading, empty
 * and error states directly — these tests are the regression net for that
 * work, not new behaviour. `useApproximateLocation` needs no mock: it is a
 * synchronous stub (see its own doc comment) that always returns the
 * Yerevan-centre fallback.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    canGoBack: () => true,
    goBack: jest.fn(),
    getState: () => ({ type: 'tab' }),
  }),
  useRoute: () => ({ params: undefined }),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../../data/api/partnersApi', () => ({ partnersApi: { nearby: jest.fn() } }));
jest.mock('../../../data/api/evApi', () => ({
  evApi: {
    nearbyStations: jest.fn(),
    activeSession: jest.fn(),
    startSession: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PartnersScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PartnersScreen — loading, empty and error states', () => {
  beforeEach(() => {
    (evApi.activeSession as jest.Mock).mockResolvedValue(null);
  });

  it('shows skeleton placeholders while both nearby queries are still pending', () => {
    (partnersApi.nearby as jest.Mock).mockReturnValue(new Promise(() => {}));
    (evApi.nearbyStations as jest.Mock).mockReturnValue(new Promise(() => {}));

    renderScreen();

    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBe(3);
    expect(screen.queryByText('partners.emptyTitle')).toBeNull();
    expect(screen.queryByText('common.error')).toBeNull();
  });

  it('shows the truthful empty state — never an invented nearby result — once both queries resolve to nothing', async () => {
    (partnersApi.nearby as jest.Mock).mockResolvedValue([]);
    (evApi.nearbyStations as jest.Mock).mockResolvedValue([]);

    renderScreen();

    await waitFor(() => expect(screen.getByText('partners.emptyTitle')).toBeTruthy());
    expect(screen.getByText('partners.emptyNearby')).toBeTruthy();
  });

  it('shows an error state with a working retry, not a silent blank list', async () => {
    (partnersApi.nearby as jest.Mock).mockRejectedValue(new Error('network down'));
    (evApi.nearbyStations as jest.Mock).mockRejectedValue(new Error('network down'));

    renderScreen();

    await waitFor(() => expect(screen.getByText('common.error')).toBeTruthy());
    expect(screen.getByText('partners.loadFailed')).toBeTruthy();

    const callsBeforeRetry = (partnersApi.nearby as jest.Mock).mock.calls.length;
    fireEvent.press(screen.getByText('common.retry'));
    await waitFor(() =>
      expect((partnersApi.nearby as jest.Mock).mock.calls.length).toBeGreaterThan(callsBeforeRetry),
    );
  });
});
