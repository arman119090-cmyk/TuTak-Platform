import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerPaymentState } from '@tutak/shared-types';
import { ProviderPaymentScreen, handoffHtml } from './ProviderPaymentScreen';
import { pspApi } from '../../../data/api/pspApi';

/**
 * The customer's side of paying inside TuTak.
 *
 * The property under test is what this screen refuses to conclude. A
 * provider's success page is a page: it can be reached by somebody who
 * abandoned the payment and missed by somebody who paid. So nothing here may
 * turn "the browser ended up somewhere" into "the money moved" — only the
 * server's status, which reports what a verified callback did.
 */

jest.mock('../../../data/api/pspApi', () => ({
  pspApi: { begin: jest.fn(), status: jest.fn() },
}));

jest.mock('react-native-webview', () => ({
  WebView: 'WebView',
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  // `Screen` asks the navigator whether it is a tab root and whether it can
  // go back, so the mock has to answer both rather than only the calls this
  // screen itself makes.
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: jest.fn(),
    getState: () => ({ type: 'stack' }),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: { purchaseIntentId: 'pi-1' } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

let activeClient: QueryClient | undefined;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProviderPaymentScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('handoffHtml', () => {
  /**
   * The provider verifies a checksum computed over exactly these values. A
   * client that reformats one — trims an amount, reorders fields — breaks the
   * signature, so the form has to carry them verbatim.
   */
  it('posts the provider’s fields verbatim, in the order given', () => {
    const html = handoffHtml({
      type: 'FORM_POST',
      method: 'POST',
      action: 'https://provider.example/pay',
      fields: { EDP_AMOUNT: '14000.00', EDP_BILL_NO: 'bill-1' },
    });

    expect(html).toContain('action="https://provider.example/pay"');
    expect(html).toContain('name="EDP_AMOUNT" value="14000.00"');
    expect(html.indexOf('EDP_AMOUNT')).toBeLessThan(html.indexOf('EDP_BILL_NO'));
    expect(html).toContain('document.forms[0].submit()');
  });

  it('escapes a field value rather than pasting it into the document', () => {
    const html = handoffHtml({
      type: 'FORM_POST',
      method: 'POST',
      action: 'https://provider.example/pay',
      fields: { EDP_DESCRIPTION: 'Coffee "<script>"' },
    });
    expect(html).not.toContain('<script>"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles a redirect provider too, without inventing a form', () => {
    const html = handoffHtml({ type: 'REDIRECT', url: 'https://provider.example/go?x=1' });
    expect(html).toContain('location.replace("https://provider.example/go?x=1")');
    expect(html).not.toContain('<form');
  });
});

describe('ProviderPaymentScreen', () => {
  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  it('offers to pay when nothing has started', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({ state: CustomerPaymentState.NOT_STARTED });
    renderScreen();
    expect(await screen.findByText(/pay for this purchase/i)).toBeTruthy();
  });

  /**
   * The merchant has to agree the economics before a bill can exist. The
   * customer is told that in their own terms rather than being shown a
   * technical refusal.
   */
  it('explains a refusal as the business not having agreed the amount', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({ state: CustomerPaymentState.NOT_STARTED });
    (pspApi.begin as jest.Mock).mockRejectedValue(new Error('not approved'));
    const { getByText } = renderScreen();
    await screen.findByText(/pay for this purchase/i);
    // The button is the only control; pressing it is what triggers `begin`.
    fireEvent.press(getByText(/^pay$/i));
    await waitFor(() => expect(screen.getByText(/agree the amount first/i)).toBeTruthy());
  });

  it('says the provider has not answered yet while waiting', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({
      state: CustomerPaymentState.WAITING_PROVIDER,
    });
    renderScreen();
    expect(await screen.findByText(/waiting for the provider/i)).toBeTruthy();
  });

  it('distinguishes "confirmed, finishing up" from "still waiting for you"', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({ state: CustomerPaymentState.PROCESSING });
    renderScreen();
    expect(await screen.findByText(/payment is confirmed/i)).toBeTruthy();
  });

  it('reports success only from the server’s own status', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({ state: CustomerPaymentState.SUCCEEDED });
    renderScreen();
    expect(await screen.findByText(/your purchase is complete/i)).toBeTruthy();
  });

  it('says nothing was charged when the provider declined', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({ state: CustomerPaymentState.FAILED });
    renderScreen();
    expect(await screen.findByText(/nothing was charged/i)).toBeTruthy();
  });

  /**
   * The honest state. Offering "try again" here is how a customer pays twice
   * for one coffee — the server refuses a second attempt while the first is
   * unresolved, so the button must not exist either.
   */
  it('tells the truth when nobody can say yet, and offers no retry', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({
      state: CustomerPaymentState.REQUIRES_RECONCILIATION,
    });
    renderScreen();
    expect(await screen.findByText(/cannot yet tell whether this payment went through/i)).toBeTruthy();
    expect(screen.queryByText(/try again/i)).toBeNull();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  it('never offers the customer a way to declare their own payment done', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue({
      state: CustomerPaymentState.WAITING_PROVIDER,
    });
    renderScreen();
    await screen.findByText(/waiting for the provider/i);
    expect(screen.queryByText(/i have paid|mark as paid|confirm payment/i)).toBeNull();
  });
});
