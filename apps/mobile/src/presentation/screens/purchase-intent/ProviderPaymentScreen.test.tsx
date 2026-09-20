import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  CustomerPaymentBlockReason,
  CustomerPaymentState,
  PurchaseIntentStatus,
  type CustomerPaymentStatusDto,
} from '@tutak/shared-types';
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

jest.mock('../../../data/network/networkState', () => ({
  useIsOffline: () => false,
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

/** The server's answer, with the pay decision spelled out the way it now is. */
function statusOf(
  state: CustomerPaymentState,
  overrides: Partial<CustomerPaymentStatusDto> = {},
): CustomerPaymentStatusDto {
  const openAndPayable =
    state === CustomerPaymentState.NOT_STARTED || state === CustomerPaymentState.FAILED;
  return {
    state,
    purchaseStatus:
      state === CustomerPaymentState.SUCCEEDED
        ? PurchaseIntentStatus.CONFIRMED
        : PurchaseIntentStatus.AWAITING_CONFIRMATION,
    canBeginPayment: openAndPayable,
    reason: openAndPayable
      ? null
      : state === CustomerPaymentState.NOT_APPLICABLE
        ? CustomerPaymentBlockReason.NOT_ROUTED
        : CustomerPaymentBlockReason.UNRESOLVED_ATTEMPT,
    ...overrides,
  };
}

/** A begin whose answer never came back. */
function lostAnswer() {
  return new AxiosError('Network Error', 'ERR_NETWORK');
}

/** A begin the server answered and refused. */
function refusal(message: string, status = 409) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: 'Conflict',
    headers: {},
    config: { headers: {} } as never,
    data: { statusCode: status, message },
  });
}

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

  it('offers to pay when the server says it may', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(statusOf(CustomerPaymentState.NOT_STARTED));
    renderScreen();
    expect(await screen.findByText(/pay for this purchase/i)).toBeTruthy();
    expect(screen.getByText(/^pay$/i)).toBeTruthy();
  });

  /**
   * U03. A status that has not arrived is not `NOT_STARTED`. The difference
   * is a pay button on a phone that cannot reach the server.
   */
  it('says it is checking, and offers no pay button, before the server answers', () => {
    (pspApi.status as jest.Mock).mockReturnValue(new Promise(() => undefined));
    renderScreen();
    expect(screen.getByText(/checking this payment/i)).toBeTruthy();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
    expect(screen.queryByText(/pay for this purchase/i)).toBeNull();
  });

  it('says the server could not be reached, and offers a retry, not a payment', async () => {
    (pspApi.status as jest.Mock).mockRejectedValue(lostAnswer());
    renderScreen();
    expect(await screen.findByText(/could not reach TuTak/i)).toBeTruthy();
    expect(screen.getByText(/nothing has been decided or charged/i)).toBeTruthy();
    expect(screen.getByText(/^try again$/i)).toBeTruthy();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
    // Nothing about the cashier: the phone does not know what the cashier did.
    expect(screen.queryByText(/cashier/i)).toBeNull();
  });

  it('keeps the last known state, marked as such, when a refresh fails', async () => {
    (pspApi.status as jest.Mock)
      .mockResolvedValueOnce(statusOf(CustomerPaymentState.WAITING_PROVIDER))
      .mockRejectedValueOnce(lostAnswer());
    renderScreen();
    await screen.findByText(/waiting for the provider/i);
    await activeClient!.refetchQueries({ queryKey: ['psp-status', 'pi-1'] });
    expect(await screen.findByText(/connection lost/i)).toBeTruthy();
    expect(screen.getByText(/waiting for the provider/i)).toBeTruthy();
  });

  /**
   * The server names the obstacle. Only "waiting for the cashier" is a
   * wait; everything else is an answer, and must not be dressed as a wait.
   */
  it('shows waiting for the cashier only when that is the reason', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.NOT_STARTED, {
        canBeginPayment: false,
        reason: CustomerPaymentBlockReason.AWAITING_MERCHANT_APPROVAL,
      }),
    );
    renderScreen();
    expect(await screen.findByText(/waiting for the cashier to agree/i)).toBeTruthy();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  it('names an expired purchase instead of blaming the cashier', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.NOT_STARTED, {
        canBeginPayment: false,
        reason: CustomerPaymentBlockReason.PURCHASE_NOT_OPEN,
        purchaseStatus: PurchaseIntentStatus.EXPIRED,
      }),
    );
    renderScreen();
    expect(await screen.findByText(/this purchase has expired/i)).toBeTruthy();
    expect(screen.queryByText(/cashier/i)).toBeNull();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  it('says the provider is switched off when that is the reason', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.NOT_STARTED, {
        canBeginPayment: false,
        reason: CustomerPaymentBlockReason.PROVIDER_DISABLED,
      }),
    );
    renderScreen();
    expect(await screen.findByText(/not available right now/i)).toBeTruthy();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  /**
   * A begin whose answer was lost may have opened a bill. The screen says it
   * does not know, re-reads, and — finding an attempt open — shows it as
   * waiting. It never sends a second begin on its own.
   */
  it('re-reads after a lost begin answer and picks up the attempt it finds', async () => {
    (pspApi.status as jest.Mock)
      .mockResolvedValueOnce(statusOf(CustomerPaymentState.NOT_STARTED))
      .mockResolvedValue(
        statusOf(CustomerPaymentState.WAITING_PROVIDER, { attemptId: 'attempt-1' }),
      );
    (pspApi.begin as jest.Mock).mockRejectedValue(lostAnswer());
    const { getByText } = renderScreen();
    await screen.findByText(/pay for this purchase/i);
    fireEvent.press(getByText(/^pay$/i));

    expect(await screen.findByText(/waiting for the provider/i)).toBeTruthy();
    expect(screen.getByText(/do not know whether the payment was opened/i)).toBeTruthy();
    expect(screen.getByText(/if the payment page did not open/i)).toBeTruthy();
    expect(pspApi.begin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  /**
   * A refusal is explained from the re-read status, not from a fixed
   * sentence about the cashier.
   */
  it('explains a refusal from the server’s reason, not a stock excuse', async () => {
    (pspApi.status as jest.Mock)
      .mockResolvedValueOnce(statusOf(CustomerPaymentState.NOT_STARTED))
      .mockResolvedValue(
        statusOf(CustomerPaymentState.NOT_STARTED, {
          canBeginPayment: false,
          reason: CustomerPaymentBlockReason.PURCHASE_NOT_OPEN,
          purchaseStatus: PurchaseIntentStatus.CANCELLED,
        }),
      );
    (pspApi.begin as jest.Mock).mockRejectedValue(refusal('Purchase is CANCELLED'));
    const { getByText } = renderScreen();
    await screen.findByText(/pay for this purchase/i);
    fireEvent.press(getByText(/^pay$/i));

    expect(await screen.findByText(/this purchase was cancelled/i)).toBeTruthy();
    expect(screen.getByText(/did not start the payment/i)).toBeTruthy();
    expect(screen.queryByText(/agree the amount first/i)).toBeNull();
    expect(pspApi.begin).toHaveBeenCalledTimes(1);
  });

  it('says the provider has not answered yet while waiting', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.WAITING_PROVIDER),
    );
    renderScreen();
    expect(await screen.findByText(/waiting for the provider/i)).toBeTruthy();
  });

  it('distinguishes "confirmed, finishing up" from "still waiting for you"', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(statusOf(CustomerPaymentState.PROCESSING));
    renderScreen();
    expect(await screen.findByText(/payment is confirmed/i)).toBeTruthy();
  });

  it('reports success only from the server’s own status', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(statusOf(CustomerPaymentState.SUCCEEDED));
    renderScreen();
    expect(await screen.findByText(/your purchase is complete/i)).toBeTruthy();
  });

  it('offers another attempt after a decline only when the server allows it', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(statusOf(CustomerPaymentState.FAILED));
    renderScreen();
    expect(await screen.findByText(/nothing was charged/i)).toBeTruthy();
    expect(screen.getByText(/try paying again/i)).toBeTruthy();
  });

  it('offers no second attempt after a decline when the server refuses one', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.FAILED, {
        canBeginPayment: false,
        reason: CustomerPaymentBlockReason.PURCHASE_NOT_OPEN,
        purchaseStatus: PurchaseIntentStatus.EXPIRED,
      }),
    );
    renderScreen();
    expect(await screen.findByText(/nothing was charged/i)).toBeTruthy();
    expect(screen.queryByText(/try paying again/i)).toBeNull();
  });

  /**
   * The honest state. Offering "try again" here is how a customer pays twice
   * for one coffee — the server refuses a second attempt while the first is
   * unresolved, so the button must not exist either.
   */
  it('tells the truth when nobody can say yet, and offers no retry', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.REQUIRES_RECONCILIATION),
    );
    renderScreen();
    expect(await screen.findByText(/cannot yet tell whether this payment went through/i)).toBeTruthy();
    expect(screen.queryByText(/try again|try paying again/i)).toBeNull();
    expect(screen.queryByText(/^pay$/i)).toBeNull();
  });

  it('never offers the customer a way to declare their own payment done', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(
      statusOf(CustomerPaymentState.WAITING_PROVIDER),
    );
    renderScreen();
    await screen.findByText(/waiting for the provider/i);
    expect(screen.queryByText(/i have paid|mark as paid|confirm payment/i)).toBeNull();
  });

  it('refreshes the wallet, its ledger and the history when a paid purchase is closed', async () => {
    (pspApi.status as jest.Mock).mockResolvedValue(statusOf(CustomerPaymentState.SUCCEEDED));
    const { getByText } = renderScreen();
    await screen.findByText(/your purchase is complete/i);
    const spy = jest.spyOn(activeClient!, 'invalidateQueries');
    fireEvent.press(getByText(/^done$/i));
    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['wallet']),
        JSON.stringify(['wallet-ledger']),
        JSON.stringify(['wallet-lots']),
        JSON.stringify(['transactions']),
      ]),
    );
    expect(mockGoBack).toHaveBeenCalled();
  });
});
