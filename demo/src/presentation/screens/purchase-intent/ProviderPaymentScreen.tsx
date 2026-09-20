import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView } from 'react-native-webview';
import {
  CustomerPaymentBlockReason,
  CustomerPaymentState,
  PurchaseIntentStatus,
  type CustomerPaymentStatusDto,
  type ProviderHandoffDto,
} from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { pspApi } from '../../../data/api/pspApi';
import { describeApiError } from '../../../data/api/errors';
import { classifyNetworkFailure } from '../../../data/network/networkFailure';
import { useIsOffline } from '../../../data/network/networkState';
import { invalidateMoney } from '../../../data/query/invalidateMoney';

/**
 * Builds the page that performs the provider's documented handoff.
 *
 * Idram's flow is a form the customer's browser posts, so there is nothing to
 * open with a URL — `Linking.openURL` can only issue a GET. The fields are
 * written into a self-submitting form exactly as the server handed them over,
 * in the order it gave them, and never re-derived here: the checksum the
 * provider verifies is computed over those values, so a client that
 * "helpfully" reformats an amount breaks the signature.
 */
export function handoffHtml(handoff: ProviderHandoffDto): string {
  if (handoff.type === 'REDIRECT') {
    // Escaped because the URL is interpolated into a document. It comes from
    // our own server, but a value that reaches HTML unescaped is a habit, not
    // a one-off.
    return `<!doctype html><meta charset="utf-8"><body>
      <script>location.replace(${JSON.stringify(handoff.url)})</script></body>`;
  }

  const inputs = Object.entries(handoff.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');

  return `<!doctype html><meta charset="utf-8"><body onload="document.forms[0].submit()">
    <form method="${escapeHtml(handoff.method)}" action="${escapeHtml(handoff.action)}">
      ${inputs}
    </form>
    <noscript><button type="submit">Continue</button></noscript>
  </body>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Paying for a purchase inside TuTak.
 *
 * ## The one rule everything here follows
 *
 * **Where the browser ends up proves nothing.** A provider's success page is
 * a page; it can be reached by a customer who abandoned the payment, and it
 * can be missed by one who paid. So this screen never reads the WebView's
 * final URL to decide anything. It polls `GET /psp/purchases/:id/status`,
 * which reports what a *verified provider callback* did, and shows the
 * customer only what the server is willing to say.
 *
 * That is why there is no "I have paid" button. There is nothing the
 * customer could tell us that we would be entitled to believe.
 *
 * ## Unknown is not "not started"
 *
 * The first version defaulted a missing status to `NOT_STARTED` and offered
 * the pay button on it — so a phone that could not reach the server was
 * shown "Pay", and every refusal from `begin` was explained as "the business
 * has to agree the amount first", whatever the refusal actually said. Now
 * the screen has a state for not knowing, the pay button follows the
 * server's own `canBeginPayment`, and a refusal is explained from the
 * server's `reason`.
 *
 * ## A lost answer is not "nothing happened"
 *
 * If `begin` gets no answer, a bill may or may not exist. The screen says
 * so, re-reads the status, and — if an attempt turns out to be open — shows
 * it as waiting rather than offering to open a second one. The server would
 * refuse a second bill anyway; the point is not to teach the customer that
 * the app is broken.
 */
export function ProviderPaymentScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ProviderPayment'>>();
  const queryClient = useQueryClient();
  const intentId = route.params.purchaseIntentId;
  const isOffline = useIsOffline();

  const [handoff, setHandoff] = useState<ProviderHandoffDto | null>(null);
  const [beginFailure, setBeginFailure] = useState<
    { kind: 'unknown' } | { kind: 'refused'; detail: string | null } | null
  >(null);

  const statusQuery = useQuery({
    queryKey: ['psp-status', intentId],
    queryFn: () => pspApi.status(intentId),
    // Polls while the answer can still change, and while there is no answer
    // at all. SUCCEEDED, FAILED and NOT_APPLICABLE are settled;
    // REQUIRES_RECONCILIATION is waiting on a person, not on the provider, so
    // hammering the endpoint would tell us nothing new — but it is checked
    // once more when the screen reopens.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      return data.state === CustomerPaymentState.NOT_STARTED ||
        data.state === CustomerPaymentState.WAITING_PROVIDER ||
        data.state === CustomerPaymentState.PROCESSING
        ? 3000
        : false;
    },
  });

  const begin = useMutation({
    mutationFn: () => pspApi.begin(intentId),
    onMutate: () => setBeginFailure(null),
    onSuccess: (result) => setHandoff(result.handoff),
    onError: (error) => {
      const failure = classifyNetworkFailure(error, isOffline);
      setBeginFailure(
        failure.status === undefined
          ? { kind: 'unknown' }
          : { kind: 'refused', detail: describeApiError(error) },
      );
      // Whatever happened, the server knows and this screen does not: a
      // lost answer may have opened a bill, a refusal has a reason. Re-read
      // before showing anything.
      void statusQuery.refetch();
    },
  });

  const status = statusQuery.data;
  const state = status?.state;
  const settled =
    state === CustomerPaymentState.SUCCEEDED ||
    state === CustomerPaymentState.FAILED ||
    state === CustomerPaymentState.REQUIRES_RECONCILIATION;

  const done = () => {
    // A succeeded payment has already moved real money and accrued bonus;
    // the wallet, its ledger and the history must reflect it the moment
    // this screen is left.
    invalidateMoney(queryClient);
    void queryClient.invalidateQueries({ queryKey: ['purchase-intent', intentId] });
    navigation.goBack();
  };

  const styles = StyleSheet.create({
    body: { padding: space[5], gap: space[4] },
    message: { ...text.bodySm, color: color.textPrimary },
    hint: { ...text.bodySm, color: color.textSecondary },
    warning: { ...text.bodySm, color: color.pendingText },
    web: { flex: 1, borderRadius: radius.md, overflow: 'hidden' },
  });

  // The provider's own page, once a bill exists and nothing has settled yet.
  if (handoff && !settled) {
    return (
      <Screen>
        <View style={styles.web}>
          <WebView
            testID="provider-webview"
            originWhitelist={['*']}
            source={{ html: handoffHtml(handoff) }}
            // Deliberately no `onNavigationStateChange` deciding success.
            // The poll above is the only thing that may conclude anything.
          />
        </View>
        <View style={styles.body}>
          <Text style={styles.hint}>{t('psp.waiting', 'Finish the payment here. We will confirm it with the provider.')}</Text>
        </View>
      </Screen>
    );
  }

  // Nothing is known yet. Not "not started": the difference between the two
  // is whether a pay button is on the screen.
  if (!status) {
    return (
      <Screen>
        <Surface>
          <View style={styles.body}>
            {statusQuery.isError ? (
              <>
                <Text style={styles.message}>{t('psp.unreachable', 'We could not reach TuTak to check this payment.')}</Text>
                <Text style={styles.hint}>{t('psp.unreachableHint', 'Nothing has been decided or charged. Check the connection and try again.')}</Text>
                <Button
                  label={t('common.retry', 'Try again')}
                  onPress={() => void statusQuery.refetch()}
                  loading={statusQuery.isFetching}
                />
                <Button label={t('common.close', 'Close')} variant="secondary" onPress={done} />
              </>
            ) : (
              <>
                <ActivityIndicator color={color.primary} />
                <Text style={styles.message}>{t('psp.checking', 'Checking this payment with TuTak…')}</Text>
              </>
            )}
          </View>
        </Surface>
      </Screen>
    );
  }

  return (
    <Screen>
      <Surface>
        <View style={styles.body}>
          {statusQuery.isError ? (
            <Text style={styles.warning} accessibilityRole="alert">
              {t('psp.stale', 'Connection lost. This is the last known state — it may have changed since.')}
            </Text>
          ) : null}

          {state === CustomerPaymentState.NOT_STARTED ? (
            status.canBeginPayment ? (
              <>
                <Text style={styles.message}>{t('psp.readyToPay', 'Pay for this purchase inside TuTak.')}</Text>
                <Button
                  label={t('psp.pay', 'Pay')}
                  onPress={() => begin.mutate()}
                  loading={begin.isPending}
                />
              </>
            ) : (
              <Blocked status={status} styles={styles} spinnerColor={color.primary} />
            )
          ) : null}

          {beginFailure?.kind === 'unknown' ? (
            <Text style={styles.warning} accessibilityRole="alert">
              {t('psp.beginUnknown', 'We could not reach TuTak, so we do not know whether the payment was opened. Checking now — nothing is charged until the provider confirms.')}
            </Text>
          ) : null}
          {beginFailure?.kind === 'refused' ? (
            <Text style={styles.warning} accessibilityRole="alert">
              {t('psp.beginRefused', 'TuTak did not start the payment. The state has been re-checked; the reason is shown above.')}
              {beginFailure.detail ? `\n${beginFailure.detail}` : ''}
            </Text>
          ) : null}

          {state === CustomerPaymentState.WAITING_PROVIDER ? (
            <>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.message}>{t('psp.waitingProvider', 'Waiting for the provider to confirm your payment.')}</Text>
              {/*
                The bill may have been opened by a begin whose answer never
                arrived; then the customer never saw the payment page. There
                is no way to re-open it from here (a second bill is exactly
                what the server refuses), so the honest thing is to say what
                happens next.
              */}
              {!handoff ? <Text style={styles.hint}>{t('psp.waitingProviderHint', 'If the payment page did not open, do not pay another way: this attempt closes by itself and staff can resolve it.')}</Text> : null}
            </>
          ) : null}

          {state === CustomerPaymentState.PROCESSING ? (
            <>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.message}>{t('psp.processing', 'Your payment is confirmed. Finishing the purchase.')}</Text>
            </>
          ) : null}

          {state === CustomerPaymentState.SUCCEEDED ? (
            <>
              <Text style={styles.message}>{t('psp.succeeded', 'Paid. Your purchase is complete.')}</Text>
              <Button label={t('common.done', 'Done')} onPress={done} />
            </>
          ) : null}

          {state === CustomerPaymentState.FAILED ? (
            <>
              <Text style={styles.message}>{t('psp.failed', 'The provider declined this payment. Nothing was charged.')}</Text>
              {/*
                A provider's explicit "no" is the one outcome that clears a
                purchase for another attempt — and only if the server says
                so now. The button is on `canBeginPayment`, not on FAILED.
              */}
              {status.canBeginPayment ? (
                <Button
                  label={t('psp.payAgain', 'Try paying again')}
                  onPress={() => begin.mutate()}
                  loading={begin.isPending}
                />
              ) : null}
              <Button label={t('common.done', 'Done')} variant="secondary" onPress={done} />
            </>
          ) : null}

          {state === CustomerPaymentState.REQUIRES_RECONCILIATION ? (
            <>
              <Text style={styles.message}>{t('psp.reconciling', 'We cannot yet tell whether this payment went through. Somebody is checking with the provider, and you will not be charged twice.')}</Text>
              {/*
                No retry button. Starting a second payment while the first is
                unresolved is exactly how a customer pays twice for one
                coffee — the server refuses it, and offering the button would
                only teach them the app is broken.
              */}
              <Text style={styles.hint}>{t('psp.reconcilingHint', 'This purchase stays open until it is resolved.')}</Text>
              <Button label={t('common.close', 'Close')} onPress={done} />
            </>
          ) : null}

          {state === CustomerPaymentState.NOT_APPLICABLE ? (
            <>
              <Text style={styles.message}>{t('psp.notApplicable', 'This purchase is paid at the till, not in TuTak.')}</Text>
              <Button label={t('common.close', 'Close')} variant="secondary" onPress={done} />
            </>
          ) : null}
        </View>
      </Surface>
    </Screen>
  );
}

/**
 * Why the pay button is not on the screen, in the server's own words.
 *
 * Only "waiting for the cashier" is a wait; the rest are answers. Telling
 * them apart is the whole point: a customer whose purchase expired must not
 * stand at the counter waiting for a cashier who has nothing left to agree.
 */
function Blocked({
  status,
  styles,
  spinnerColor,
}: {
  status: CustomerPaymentStatusDto;
  styles: { message: object; hint: object };
  spinnerColor: string;
}) {
  const { t } = useTranslation();
  const reason = status.reason;

  if (reason === CustomerPaymentBlockReason.AWAITING_MERCHANT_APPROVAL) {
    return (
      <>
        <ActivityIndicator color={spinnerColor} />
        <Text style={styles.message}>{t('psp.awaitingMerchant', 'Waiting for the cashier to agree the amount. You can pay as soon as they do.')}</Text>
      </>
    );
  }
  if (reason === CustomerPaymentBlockReason.PROVIDER_DISABLED) {
    return <Text style={styles.message}>{t('psp.providerDisabled', 'Paying inside TuTak is not available right now. Pay at the till.')}</Text>;
  }
  if (reason === CustomerPaymentBlockReason.NOTHING_TO_COLLECT) {
    return <Text style={styles.message}>{t('psp.nothingToCollect', 'Bonus covers the whole purchase — there is nothing to pay here.')}</Text>;
  }
  if (reason === CustomerPaymentBlockReason.UNRESOLVED_ATTEMPT) {
    return <Text style={styles.message}>{t('psp.unresolvedAttempt', 'An earlier payment attempt is not resolved yet. A new one cannot start — that is what keeps you from paying twice.')}</Text>;
  }
  if (reason === CustomerPaymentBlockReason.NOT_ROUTED) {
    return <Text style={styles.message}>{t('psp.notApplicable', 'This purchase is paid at the till, not in TuTak.')}</Text>;
  }
  // PURCHASE_NOT_OPEN, or a reason this build does not know: name the
  // purchase's own state, which the server sent alongside.
  switch (status.purchaseStatus) {
    case PurchaseIntentStatus.EXPIRED:
      return <Text style={styles.message}>{t('psp.purchaseExpired', 'This purchase has expired. Nothing was charged.')}</Text>;
    case PurchaseIntentStatus.REJECTED:
      return <Text style={styles.message}>{t('psp.purchaseRejected', 'The cashier declined this purchase. Nothing was charged.')}</Text>;
    case PurchaseIntentStatus.CANCELLED:
      return <Text style={styles.message}>{t('psp.purchaseCancelled', 'This purchase was cancelled. Nothing was charged.')}</Text>;
    case PurchaseIntentStatus.CONFIRMED:
      return <Text style={styles.message}>{t('psp.purchaseConfirmed', 'This purchase is already confirmed.')}</Text>;
    default:
      return <Text style={styles.message}>{t('psp.purchaseClosed', 'This purchase is closed and cannot be paid.')}</Text>;
  }
}
