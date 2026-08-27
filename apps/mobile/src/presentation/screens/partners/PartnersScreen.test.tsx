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

/**
 * Every station a customer can find here is chargeable through this app —
 * every `EvStationProvider` value is started/stopped by TuTak (Arman,
 * 2026-08-26: "все станции могли заряжаться только из нашего application
 * исключительно"), so this screen never has to special-case one: whatever
 * `nearbyStations` returns always gets the ordinary tappable connector strip.
 */
describe('PartnersScreen — station Start behaviour', () => {
  const internalStation = {
    id: 'station-internal',
    partnerId: 'partner-1',
    name: 'TuTak Kentron',
    address: '1 Mashtots Ave',
    city: 'Yerevan',
    latitude: 40.18,
    longitude: 44.51,
    ocpiLocationId: null,
    provider: 'INTERNAL',
    externalStationId: null,
    standardRetailRatePerKwh: null,
    connectors: [
      {
        id: 'connector-internal',
        stationId: 'station-internal',
        ocpiEvseUid: null,
        externalConnectorId: null,
        connectorType: 'CCS2',
        status: 'AVAILABLE',
        powerKw: 50,
        pricePerKwh: '100.00',
      },
    ],
  };

  beforeEach(() => {
    (evApi.activeSession as jest.Mock).mockResolvedValue(null);
    (partnersApi.nearby as jest.Mock).mockResolvedValue([]);
  });

  it('shows a tappable Start target for a station the nearby list returned', async () => {
    (evApi.nearbyStations as jest.Mock).mockResolvedValue([internalStation]);
    (evApi.startSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      connectorId: 'connector-internal',
      status: 'CHARGING',
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText('TuTak Kentron')).toBeTruthy());

    const startTarget = screen.getByLabelText('ev.startAt');
    fireEvent.press(startTarget);

    await waitFor(() => expect(evApi.startSession).toHaveBeenCalledWith({ connectorId: 'connector-internal' }));
  });
});
