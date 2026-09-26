import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView } from 'react-native-webview';
import { CustomerPaymentState, type ProviderHandoffDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { pspApi } from '../../../data/api/pspApi';

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
 * ## What the states mean to a person
 *
 * `PROCESSING` is not a spinner for its own sake: a verified confirmation is
 * in hand and its effects are being applied. `REQUIRES_RECONCILIATION` is the
 * honest one — nobody can say yet whether the money moved, a human is
 * looking, and the customer is told exactly that rather than being shown a
 * failure that might be wrong.
 */
export function ProviderPaymentScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ProviderPayment'>>();
  const queryClient = useQueryClient();
  const intentId = route.params.purchaseIntentId;

  const [handoff, setHandoff] = useState<ProviderHandoffDto | null>(null);

  const begin = useMutation({
    mutationFn: () => pspApi.begin(intentId),
    onSuccess: (result) => setHandoff(result.handoff),
  });

  const { data: status } = useQuery({
    queryKey: ['psp-status', intentId],
    queryFn: () => pspApi.status(intentId),
    // Polls only while the answer can still change. SUCCEEDED, FAILED and
    // NOT_APPLICABLE are settled; REQUIRES_RECONCILIATION is waiting on a
    // person, not on the provider, so hammering the endpoint would tell us
    // nothing new — but it is checked once more when the screen reopens.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === CustomerPaymentState.NOT_STARTED ||
        state === CustomerPaymentState.WAITING_PROVIDER ||
        state === CustomerPaymentState.PROCESSING
        ? 3000
        : false;
    },
  });

  const state = status?.state ?? CustomerPaymentState.NOT_STARTED;
  const settled =
    state === CustomerPaymentState.SUCCEEDED ||
    state === CustomerPaymentState.FAILED ||
    state === CustomerPaymentState.REQUIRES_RECONCILIATION;

  const done = () => {
    // A succeeded payment has already moved real money and accrued bonus;
    // the wallet must reflect it the moment this screen is left.
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    navigation.goBack();
  };

  const styles = StyleSheet.create({
    body: { padding: space[5], gap: space[4] },
    message: { ...text.bodySm, color: color.textPrimary },
    hint: { ...text.bodySm, color: color.textSecondary },
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
          <Text style={styles.hint}>
            {t('psp.waiting', 'Finish the payment here. We will confirm it with the provider.')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Surface>
        <View style={styles.body}>
          {state === CustomerPaymentState.NOT_STARTED ? (
            <>
              <Text style={styles.message}>
                {t('psp.readyToPay', 'Pay for this purchase inside TuTak.')}
              </Text>
              <Button
                    label={t('psp.pay', 'Pay')}
                onPress={() => begin.mutate()}
                loading={begin.isPending}
              />
              {begin.isError ? (
                <Text style={styles.hint}>
                  {t(
                    'psp.beginFailed',
                    'This purchase cannot be paid yet. The business has to agree the amount first.',
                  )}
                </Text>
              ) : null}
            </>
          ) : null}

          {state === CustomerPaymentState.WAITING_PROVIDER ? (
            <>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.message}>
                {t('psp.waitingProvider', 'Waiting for the provider to confirm your payment.')}
              </Text>
            </>
          ) : null}

          {state === CustomerPaymentState.PROCESSING ? (
            <>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.message}>
                {t('psp.processing', 'Your payment is confirmed. Finishing the purchase.')}
              </Text>
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
              <Text style={styles.message}>
                {t('psp.failed', 'The provider declined this payment. Nothing was charged.')}
              </Text>
              <Button label={t('common.done', 'Done')} onPress={done} />
            </>
          ) : null}

          {state === CustomerPaymentState.REQUIRES_RECONCILIATION ? (
            <>
              <Text style={styles.message}>
                {t(
                  'psp.reconciling',
                  'We cannot yet tell whether this payment went through. Somebody is checking with the provider, and you will not be charged twice.',
                )}
              </Text>
              {/*
                No retry button. Starting a second payment while the first is
                unresolved is exactly how a customer pays twice for one
                coffee — the server refuses it, and offering the button would
                only teach them the app is broken.
              */}
              <Text style={styles.hint}>
                {t('psp.reconcilingHint', 'This purchase stays open until it is resolved.')}
              </Text>
              <Button label={t('common.close', 'Close')} onPress={done} />
            </>
          ) : null}

          {state === CustomerPaymentState.NOT_APPLICABLE ? (
            <Text style={styles.message}>
              {t('psp.notApplicable', 'This purchase is paid at the till, not in TuTak.')}
            </Text>
          ) : null}
        </View>
      </Surface>
    </Screen>
  );
}
