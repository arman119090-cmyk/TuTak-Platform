import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ScanQrScreen } from './ScanQrScreen';
import { qrApi } from '../../../data/api/qrApi';

/**
 * NEXT_CLAUDE_TASK.md requirement 1 / 10: scanning a partner's code must
 * open a PurchaseIntent and must never reach the legacy `qrApi.redeem()`
 * charge — this is the regression that proves the old financial path is no
 * longer wired to the normal customer scan flow, not just that it still
 * exists on the backend for compatibility.
 */

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    canGoBack: () => true,
    goBack: jest.fn(),
    getState: () => ({ type: 'stack' }),
  }),
}));

let capturedOnBarcodeScanned: ((event: { data: string }) => void) | null = null;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void }) => {
    capturedOnBarcodeScanned = props.onBarcodeScanned;
    return null;
  },
}));

jest.mock('../../../data/api/qrApi', () => ({
  qrApi: { redeem: jest.fn(), issue: jest.fn() },
}));

jest.mock('../../components/DemoOnly', () => ({ DemoOnly: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const renderScreen = () => render(<ThemeProvider><ScanQrScreen /></ThemeProvider>);

describe('ScanQrScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    (qrApi.redeem as jest.Mock).mockClear();
    capturedOnBarcodeScanned = null;
  });

  it('opens a PurchaseIntent for a valid partner code, never touching qrApi.redeem', () => {
    renderScreen();
    expect(capturedOnBarcodeScanned).toBeTruthy();

    act(() => {
      capturedOnBarcodeScanned!({ data: 'TUTAK-PAY:partner-sas' });
    });

    expect(mockReplace).toHaveBeenCalledWith('CreatePurchaseIntent', { partnerId: 'partner-sas' });
    expect(qrApi.redeem).not.toHaveBeenCalled();
  });

  it('refuses an unrecognised code instead of guessing what it means', () => {
    const { getByText } = renderScreen();

    act(() => {
      capturedOnBarcodeScanned!({ data: 'https://not-a-tutak-code.example' });
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(qrApi.redeem).not.toHaveBeenCalled();
    // react-i18next has no instance configured in this test environment
    // (see the `NO_I18NEXT_INSTANCE` warning), so `t()` returns the raw
    // key rather than the translated copy — asserting on the key is what
    // actually proves the invalid-code branch rendered.
    expect(getByText('qr.invalidCode')).toBeTruthy();
  });
});
