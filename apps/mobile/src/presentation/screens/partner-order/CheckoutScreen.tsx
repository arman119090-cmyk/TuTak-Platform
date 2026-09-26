import React from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { JakoWingMark } from '../../components/V2NavIcon';
import { partnerOrderApi } from '../../../data/api/partnerOrderApi';
import { customerBalanceApi } from '../../../data/api/customerBalanceApi';
import { describeApiError } from '../../../data/api/errors';
import { computeCheckoutSplit, parseCheckoutAmount } from '@tutak/shared-types';
import { formatAmd } from '../../utils/format';

/**
 * TuTak Checkout (spec §4, §20-23, §30, §69; Q1 = C). Opened from
 * `tutak://checkout/<orderId>` (the partner's website hands the customer
 * over) or from "Мои заказы". Logging in is not consent: nothing is charged
 * until "Подтвердить заказ".
 *
 * The customer chooses how much comes from the green discount balance and
 * how much from their TuTak money — two separate balances, shown separately
 * — and the rest is paid to the seller directly. If the TuTak money falls
 * short, the missing amount is shown with a top-up for exactly that amount,
 * and the customer comes back to this same checkout.
 */
export function CheckoutScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Checkout'>>();
  const { orderId } = route.params;
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [topUpNote, setTopUpNote] = React.useState<string | null>(null);
  const [discount, setDiscount] = React.useState('');
  const [money, setMoney] = React.useState('');

  const { data: checkout, isLoading, refetch } = useQuery({
    queryKey: ['partner-order-checkout', orderId],
    queryFn: () => partnerOrderApi.getCheckout(orderId),
  });

  const order = checkout?.order;
  const total = order ? Number(order.totalAmount) : 0;
  const discountAvailable = checkout ? Number(checkout.balances.discountAvailable) : 0;
  const moneyBalance = checkout ? Number(checkout.balances.tutakMoney) : 0;
  const maxDiscount = checkout ? Math.min(Number(checkout.limits.maxDiscountAmount), discountAvailable, total) : 0;
  const prepayment = checkout ? Number(checkout.limits.prepaymentRequiredAmount) : 0;

  // Shared with TuTak Web Checkout. Q13: only real money secures the
  // prepayment — the discount lowers the price but never counts toward it
  // (the API enforces the same rule).
  const split = computeCheckoutSplit({
    total,
    discountAvailable,
    maxDiscountAmount: checkout ? Number(checkout.limits.maxDiscountAmount) : 0,
    moneyBalance,
    prepaymentRequired: prepayment,
    discountInput: parseCheckoutAmount(discount),
    moneyInput: parseCheckoutAmount(money),
  });
  const { discount: discountValue, money: moneyValue, external: externalValue, missingMoney, prepaymentShort } = split;

  const submit = useMutation({
    mutationFn: () =>
      partnerOrderApi.submit(orderId, {
        discountAmount: discountValue ? String(discountValue) : undefined,
        tutakMoneyAmount: moneyValue ? String(moneyValue) : undefined,
        // The same choice retried is the same request — never a second charge.
        idempotencyKey: `checkout-${orderId}-${discountValue}-${moneyValue}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-balance'] });
      queryClient.invalidateQueries({ queryKey: ['partner-orders-mine'] });
      refetch();
    },
    onError: (err) => setError(describeApiError(err) ?? t('common.error')),
  });

  const topUp = useMutation({
    mutationFn: () => customerBalanceApi.topUp(String(missingMoney), `topup-${orderId}-${missingMoney}`),
    onSuccess: async (result) => {
      if (result.redirectUrl) {
        await Linking.openURL(result.redirectUrl);
        return;
      }
      setTopUpNote(t('partnerOrder.topUpUnavailable'));
    },
    onError: () => setTopUpNote(t('partnerOrder.topUpUnavailable')),
  });

  if (isLoading || !checkout || !order) {
    return (
      <Screen title={t('partnerOrder.checkoutTitle')}>
        <ActivityIndicator color={color.primary} />
      </Screen>
    );
  }

  const row = (label: string, value: string, strong = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}>
      <Text style={[text.bodySm, { color: color.textSecondary }]}>{label}</Text>
      <Text style={[strong ? text.headline : text.body, { color: color.textPrimary }]}>{value}</Text>
    </View>
  );

  const confirmed = order.submittedAt !== null;

  return (
    <Screen title={t('partnerOrder.checkoutTitle')}>
      <Surface style={{ marginBottom: space[4] }}>
        {row(t('partnerOrder.fromPartner'), checkout.partner.displayName)}
        {row(t('partnerOrder.orderNumberLabel'), `#${order.orderNumber}`)}
        <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[3] }]}>{t('partnerOrder.itemsLabel')}</Text>
        {order.items.map((item) => (
          <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}>
            <Text style={[text.body, { color: color.textPrimary, flex: 1 }]}>
              {item.quantity}× {item.name}
            </Text>
            <Text style={[text.body, { color: color.textPrimary }]}>{formatAmd(item.totalPrice)}</Text>
          </View>
        ))}
        {row(t('partnerOrder.totalLabel'), formatAmd(order.totalAmount), true)}
      </Surface>

      {confirmed ? (
        <Surface>
          <Text style={[text.body, { color: color.availableText }]}>{t('partnerOrder.confirmedNotice')}</Text>
          <View style={{ marginTop: space[3] }}>
            <Button label={t('partnerOrder.myOrdersTitle')} variant="secondary" onPress={() => navigation.navigate('MyOrders')} />
          </View>
        </Surface>
      ) : (
        <>
          {prepayment > 0 ? (
            <Surface style={{ marginBottom: space[4] }}>
              <Text style={[text.bodySm, { color: color.textPrimary }]}>
                {t('partnerOrder.prepaymentNotice', { amount: formatAmd(prepayment) })}
              </Text>
              <Text style={[text.caption, { color: color.textTertiary, marginTop: space[1] }]}>{t('partnerOrder.prepaymentMoneyOnly')}</Text>
            </Surface>
          ) : null}
          {checkout.cancellationTerms ? (
            <Surface style={{ marginBottom: space[4] }}>
              <Text style={[text.bodySm, { color: color.textSecondary }]}>
                {t('partnerOrder.cancellationTerms', { terms: checkout.cancellationTerms })}
              </Text>
            </Surface>
          ) : null}

          <Surface style={{ marginBottom: space[4] }}>
            <Text style={[text.label, { color: color.textPrimary, marginBottom: space[3] }]}>{t('partnerOrder.howToPay')}</Text>
            <TextField
              label={t('partnerOrder.discountLabel')}
              hint={t('partnerOrder.discountHint', { amount: formatAmd(discountAvailable), max: formatAmd(maxDiscount) })}
              keyboardType="number-pad"
              value={discount}
              onChangeText={setDiscount}
              placeholder="0"
            />
            <View style={{ height: space[3] }} />
            <TextField
              label={t('partnerOrder.moneyLabel')}
              hint={t('partnerOrder.moneyHint', { amount: formatAmd(moneyBalance) })}
              keyboardType="number-pad"
              value={money}
              onChangeText={setMoney}
              placeholder="0"
              error={missingMoney > 0 ? t('partnerOrder.missingMoney', { amount: formatAmd(missingMoney) }) : undefined}
            />
            {row(t('partnerOrder.externalLabel'), formatAmd(externalValue))}
            <Text style={[text.caption, { color: color.textTertiary, marginTop: space[1] }]}>{t('partnerOrder.externalHint')}</Text>
          </Surface>

          {missingMoney > 0 ? (
            <Surface style={{ marginBottom: space[4] }}>
              <Button
                label={t('partnerOrder.topUpCta', { amount: formatAmd(missingMoney) })}
                variant="secondary"
                loading={topUp.isPending}
                onPress={() => {
                  setTopUpNote(null);
                  topUp.mutate();
                }}
              />
              {topUpNote ? <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2] }]}>{topUpNote}</Text> : null}
            </Surface>
          ) : null}

          {prepaymentShort > 0 ? (
            <Text style={[text.bodySm, { color: color.dangerText, marginBottom: space[3] }]}>
              {t('partnerOrder.prepaymentShort', { amount: formatAmd(prepaymentShort) })}
            </Text>
          ) : null}
          {error ? <Text style={[text.bodySm, { color: color.dangerText, marginBottom: space[3] }]}>{error}</Text> : null}

          <Text style={[text.caption, { color: color.textTertiary, marginBottom: space[3] }]}>{t('partnerOrder.loginIsNotConsent')}</Text>
          <Button
            label={t('partnerOrder.confirmButton')}
            disabled={missingMoney > 0 || prepaymentShort > 0}
            onPress={() => {
              setError(null);
              submit.mutate();
            }}
            loading={submit.isPending}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
        </>
      )}
    </Screen>
  );
}
