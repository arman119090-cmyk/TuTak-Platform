import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { PartnerCategory } from '@tutak/shared-types';
import { BecomePartnerScreen } from './BecomePartnerScreen';
import { partnersApi } from '../../../data/api/partnersApi';
import { DEFAULT_RATE_BPS } from './CashbackRateField';

/**
 * The form is one page with Jako at the top, and the request is exactly what
 * it has always been: same fields, same trims, same optional tax id, same
 * navigation on success. These tests pin that — a redesign that changed what
 * reaches `POST /partners/apply` would fail here.
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

  it('is one page: Jako greeting, three fields, category, cashback and the button', () => {
    renderScreen();
    expect(screen.getByTestId('scene-partner-welcome', hidden)).toBeTruthy();
    expect(screen.getByText('scene.note.login', hidden)).toBeTruthy();
    expect(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder')).toBeTruthy();
    expect(screen.getByPlaceholderText('becomePartner.taxIdPlaceholder')).toBeTruthy();
    expect(screen.getByText(`partnerCategory.${PartnerCategory.GROCERY}`)).toBeTruthy();
    expect(screen.getByText('becomePartner.submit')).toBeTruthy();
    expect(screen.getByText('scene.dataSafe')).toBeTruthy();
  });

  it('keeps the button off until both names reach the server minimum', () => {
    renderScreen();
    const button = () => screen.getByRole('button', { name: 'becomePartner.submit' });
    expect(button().props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), 'Nairi Foods LLC');
    expect(button().props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'N');
    expect(button().props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi');
    expect(button().props.accessibilityState.disabled).toBe(false);
  });

  it('sends exactly what the form has always sent, and replaces the screen on success', async () => {
    mockedApply.mockResolvedValue({ id: 'p1' });
    const { replace } = renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), '  Nairi Foods LLC ');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi ');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.taxIdPlaceholder'), ' 01234567 ');
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

  it('leaves the tax id out of the request when the field is empty', async () => {
    mockedApply.mockResolvedValue({ id: 'p1' });
    renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), 'Nairi Foods LLC');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi');
    fireEvent.press(screen.getByText('becomePartner.submit'));
    await waitFor(() => expect(mockedApply).toHaveBeenCalledTimes(1));
    expect(mockedApply.mock.calls[0][0]).not.toHaveProperty('taxId');
  });

  it('says "already under review" in the person\'s language on a 409', async () => {
    const axios = jest.requireActual('axios');
    mockedApply.mockRejectedValue(new axios.AxiosError('conflict', '409', undefined, undefined, { status: 409, data: {}, statusText: '', headers: {}, config: {} } as never));
    renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.legalNamePlaceholder'), 'Nairi Foods LLC');
    fireEvent.changeText(screen.getByPlaceholderText('becomePartner.displayNamePlaceholder'), 'Nairi');
    fireEvent.press(screen.getByText('becomePartner.submit'));
    expect(await screen.findByText('becomePartner.alreadyApplied')).toBeTruthy();
  });
});
