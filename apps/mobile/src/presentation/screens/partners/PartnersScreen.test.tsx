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
jest.mock('../../utils/fastChargeDeepLink', () => ({ openFastChargeApp: jest.fn().mockResolvedValue(true) }));

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
 * FastCharge integration (docs/FASTCHARGE_INTEGRATION_2026-08-25.md),
 * requirement 1: TuTak must never send a start/stop command to a
 * FastCharge-provider station. This is the regression net for that —
 * proving both halves: the FastCharge deep-link footer replaces Start on a
 * FASTCHARGE station, and every non-FastCharge station keeps its ordinary
 * tappable Start behaviour exactly as before.
 */
describe('PartnersScreen — FastCharge stations never show Start/Stop', () => {
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

  const fastChargeStation = {
    id: 'station-fastcharge',
    partnerId: 'partner-2',
    name: 'FastCharge Davtashen',
    address: '5 Davtashen Hwy',
    city: 'Yerevan',
    latitude: 40.21,
    longitude: 44.47,
    ocpiLocationId: null,
    provider: 'FASTCHARGE',
    externalStationId: 'fc-station-1',
    standardRetailRatePerKwh: '115.00',
    connectors: [
      {
        id: 'connector-fastcharge',
        stationId: 'station-fastcharge',
        ocpiEvseUid: null,
        externalConnectorId: 'fc-connector-1',
        connectorType: 'CCS2',
        status: 'AVAILABLE',
        powerKw: 120,
        pricePerKwh: '115.00',
      },
    ],
  };

  beforeEach(() => {
    (evApi.activeSession as jest.Mock).mockResolvedValue(null);
    (partnersApi.nearby as jest.Mock).mockResolvedValue([]);
  });

  it('shows the "open FastCharge app" deep-link footer, with no tappable Start target, for a FASTCHARGE station', async () => {
    (evApi.nearbyStations as jest.Mock).mockResolvedValue([fastChargeStation]);

    renderScreen();

    await waitFor(() => expect(screen.getByText('FastCharge Davtashen')).toBeTruthy());
    expect(screen.getByText('ev.openFastChargeApp')).toBeTruthy();
    // The ordinary Start accessibility label must never be attached to a
    // FastCharge station's connector.
    expect(screen.queryByLabelText(/startAt|Start charging/i)).toBeNull();

    fireEvent.press(screen.getByText('ev.openFastChargeApp'));
    const { openFastChargeApp } = jest.requireMock('../../utils/fastChargeDeepLink') as {
      openFastChargeApp: jest.Mock;
    };
    await waitFor(() => expect(openFastChargeApp).toHaveBeenCalled());
    expect(evApi.startSession).not.toHaveBeenCalled();
  });

  it('keeps the ordinary tappable Start behaviour on a non-FastCharge (INTERNAL) station, unchanged', async () => {
    (evApi.nearbyStations as jest.Mock).mockResolvedValue([internalStation]);
    (evApi.startSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      connectorId: 'connector-internal',
      status: 'CHARGING',
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText('TuTak Kentron')).toBeTruthy());
    expect(screen.queryByText('ev.openFastChargeApp')).toBeNull();

    const startTarget = screen.getByLabelText('ev.startAt');
    fireEvent.press(startTarget);

    await waitFor(() => expect(evApi.startSession).toHaveBeenCalledWith({ connectorId: 'connector-internal' }));
  });
});
