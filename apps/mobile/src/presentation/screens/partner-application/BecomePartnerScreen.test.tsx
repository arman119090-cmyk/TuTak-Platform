import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { PartnerCategory } from '@tutak/shared-types';
import { BecomePartnerScreen } from './BecomePartnerScreen';
import { partnersApi } from '../../../data/api/partnersApi';
import { DEFAULT_RATE_BPS } from './CashbackRateField';

/**
 * The journey is now three steps and a filed state, but the request is the
 * one the single-page form sent: same fields, same trims, same optional tax
 * id, same navigation on success. These tests pin that — a redesign that
 * changed what reaches `POST /partners/apply` would fail here.
 */
jest.mock('../../../data/api/partnersApi', () => ({
  partnersApi: { apply: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const mockedApply = partnersApi.apply as jest.Mock;

function renderScreen() {
  const replace = jest.fn();
  const goBack = jest.fn();
  // `gcTime: 0` on both: the mutation cache otherwise arms a five-minute
  // garbage-collection timer that keeps the jest process alive after the
  // last assertion — the run does not fail, it sits there until killed.
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: 0 }, queries: { retry: false, gcTime: 0 } },
  });
  render(
    <NavigationContainer>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <BecomePartnerScreen
            navigation={{ replace, goBack, navigate: jest.fn() } as never}
            route={{ key: 'BecomePartner', name: 'BecomePartner' } as never}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </NavigationContainer>,
  );
  return { replace, goBack };
}

const hidden = { includeHiddenElements: true };

describe('BecomePartnerScreen', () => {
  beforeEach(() => {
    mockedApply.mockReset();
  });

  it('opens on the welcome step with the greeting Jako and no fields', () => {
    renderScreen();
    expect(screen.getByTestId('jako-partner-welcome', hidden)).toBeTruthy();
    expect(screen.queryByText('becomePartner.legalName')).toBeNull();
    expect(screen.getByText('becomePartner.start')).toBeTruthy();
  });

  it('walks welcome → details → offer, each with its own Jako, and does not let details through empty', () => {
    renderScreen();
    fireEvent.press(screen.getByText('becomePartner.start'));
    expect(screen.getByTestId('jako-partner-details', hidden)).toBeTruthy();
    expect(screen.getByText('becomePartner.stepOf')).toBeTruthy();

    // Both names are required by the server (min 2), so "next" waits.
    const next = screen.getByText('common.next');
    fireEvent.press(next);
    expect(screen.queryByTestId('jako-partner-offer', hidden)).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), 'Nairi Foods LLC');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi');
    fireEvent.press(screen.getByText('common.next'));
    expect(screen.getByTestId('jako-partner-offer', hidden)).toBeTruthy();
    expect(screen.getByText('becomePartner.submit')).toBeTruthy();
  });

  it('goes back a step, and back off the screen from the first one', () => {
    const { goBack } = renderScreen();
    fireEvent.press(screen.getByText('becomePartner.start'));
    fireEvent.press(screen.getByText('common.back'));
    expect(screen.getByTestId('jako-partner-welcome', hidden)).toBeTruthy();
    expect(goBack).not.toHaveBeenCalled();
  });

  it('sends exactly what the single-page form sent, and replaces the screen on success', async () => {
    mockedApply.mockResolvedValue({ id: 'p1' });
    const { replace } = renderScreen();
    fireEvent.press(screen.getByText('becomePartner.start'));
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), '  Nairi Foods LLC ');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi ');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.taxIdPlaceholder'), ' 01234567 ');
    fireEvent.press(screen.getByText('common.next'));

    // Pick a category other than the default, then file.
    fireEvent.press(screen.getByText(`partnerCategory.${PartnerCategory.CAFE}`));
    fireEvent.press(screen.getByText('becomePartner.submit'));

    await waitFor(() => expect(mockedApply).toHaveBeenCalledTimes(1));
    expect(mockedApply).toHaveBeenCalledWith({
      legalName: 'Nairi Foods LLC',
      displayName: 'Nairi',
      taxId: '01234567',
      category: PartnerCategory.CAFE,
      bonusAccrualRateBps: DEFAULT_RATE_BPS,
    });
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('PartnerApplicationSent', {
        displayName: 'Nairi',
        category: PartnerCategory.CAFE,
        rateBps: DEFAULT_RATE_BPS,
        taxId: '01234567',
      }),
    );
  });

  it('says "already under review" in the person\'s language on a 409', async () => {
    const axios = jest.requireActual('axios');
    mockedApply.mockRejectedValue(new axios.AxiosError('conflict', '409', undefined, undefined, { status: 409, data: {}, statusText: '', headers: {}, config: {} } as never));
    renderScreen();
    fireEvent.press(screen.getByText('becomePartner.start'));
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), 'Nairi Foods LLC');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi');
    fireEvent.press(screen.getByText('common.next'));
    fireEvent.press(screen.getByText('becomePartner.submit'));
    expect(await screen.findByText('becomePartner.alreadyApplied')).toBeTruthy();
  });
});
