import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OtpRegisterScreen } from './OtpRegisterScreen';

const mockSetSession = jest.fn();
const mockNavigate = jest.fn();

/** A stateful stand-in for the hook, so ticking a box behaves as it does in the app. */
const mockConsentState: { accepted: Record<string, boolean> } = { accepted: {} };
const mockRequired = [
  {
    purpose: 'TERMS_AND_BONUS_RULES',
    labelKey: 'legal.consentTerms',
    documents: [
      { key: 'terms', contentHash: 'a'.repeat(64) },
      { key: 'bonus-refunds', contentHash: 'b'.repeat(64) },
    ],
  },
  {
    purpose: 'PERSONAL_DATA_REQUIRED',
    labelKey: 'legal.consentPersonalData',
    documents: [
      { key: 'consent', contentHash: 'c'.repeat(64) },
      { key: 'privacy', contentHash: 'd'.repeat(64) },
    ],
  },
];

jest.mock('./useRegistrationConsents', () => ({
  useRegistrationConsents: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const [, force] = (require('react') as typeof import('react')).useState(0);
    const satisfied = mockRequired.every((entry) => mockConsentState.accepted[entry.purpose]);
    return {
      required: mockRequired,
      accepted: mockConsentState.accepted,
      setAccepted: (purpose: string, next: boolean) => {
        mockConsentState.accepted = { ...mockConsentState.accepted, [purpose]: next };
        force((n) => n + 1);
      },
      satisfied,
      language: 'ru',
      payload: satisfied
        ? mockRequired.map((entry) => ({
            purpose: entry.purpose,
            language: 'ru',
            revision: '1.0-test',
            documents: entry.documents,
          }))
        : null,
    };
  },
}));
jest.mock('../../../data/api/authApi', () => ({
  authApi: { requestRegistrationOtp: jest.fn(), verifyRegistrationOtp: jest.fn() },
}));
jest.mock('../../../data/stores/authStore', () => ({
  useAuthStore: () => ({ deviceId: 'test-device', setSession: mockSetSession }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { authApi } = require('../../../data/api/authApi');
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

const renderScreen = () =>
  render(
    <ThemeProvider>
      <NavigationContainer>
        <OtpRegisterScreen
          navigation={{ navigate: mockNavigate, replace: jest.fn() } as never}
          route={{ key: 'OtpRegister', name: 'OtpRegister' } as never}
        />
      </NavigationContainer>
    </ThemeProvider>,
  );

/**
 * The two mandatory choices on the registration form.
 *
 * What the brief asks for, and what these pin: both boxes start empty, they
 * are independent of each other, no code is requested until both are ticked,
 * each document is readable from here before anything is sent, and the
 * choices travel with the very first request rather than after the SMS.
 */
describe('the legal consents on the registration form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConsentState.accepted = {};
    authApi.requestRegistrationOtp.mockResolvedValue({ success: true });
  });

  it('starts with both boxes empty', () => {
    renderScreen();
    expect(screen.getByTestId('consent-TERMS_AND_BONUS_RULES').props.accessibilityState.checked).toBe(
      false,
    );
    expect(screen.getByTestId('consent-PERSONAL_DATA_REQUIRED').props.accessibilityState.checked).toBe(
      false,
    );
  });

  it('says out loud that marketing, location and biometrics are a separate choice', () => {
    renderScreen();
    expect(screen.getByTestId('consent-optional-note')).toBeTruthy();
  });

  it('sends no code until both independent choices are made', async () => {
    renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('00 000 000'), '77123456');

    fireEvent.press(screen.getByText('auth.sendVerificationCode'));
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();

    // One of the two is not enough — they are not a single "agree to all".
    fireEvent.press(screen.getByTestId('consent-TERMS_AND_BONUS_RULES'));
    fireEvent.press(screen.getByText('auth.sendVerificationCode'));
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('consent-PERSONAL_DATA_REQUIRED'));
    fireEvent.press(screen.getByText('auth.sendVerificationCode'));

    await waitFor(() => expect(authApi.requestRegistrationOtp).toHaveBeenCalledTimes(1));
    expect(authApi.requestRegistrationOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+37477123456',
        consents: [
          expect.objectContaining({ purpose: 'TERMS_AND_BONUS_RULES', revision: '1.0-test' }),
          expect.objectContaining({ purpose: 'PERSONAL_DATA_REQUIRED', revision: '1.0-test' }),
        ],
      }),
    );
  });

  it('opens the full text of each named document before anything is sent', () => {
    renderScreen();
    // The test i18n returns the fallback, which is the document key itself.
    fireEvent.press(screen.getByText('privacy'));
    expect(mockNavigate).toHaveBeenCalledWith('LegalDocument', {
      documentKey: 'privacy',
      language: 'ru',
      title: 'privacy',
    });
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the reader comes back from a document', () => {
    renderScreen();
    fireEvent.changeText(screen.getByPlaceholderText('00 000 000'), '77123456');
    fireEvent.press(screen.getByText('terms'));
    // The form is pushed under, not unmounted: the field still holds the number.
    expect(screen.getByPlaceholderText('00 000 000').props.value).toBe('77123456');
  });
});
