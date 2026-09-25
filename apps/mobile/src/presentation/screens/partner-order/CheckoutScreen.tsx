import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { partnerOrderApi } from '../../../data/api/partnerOrderApi';
import { customerBalanceApi } from '../../../data/api/customerBalanceApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd } from '../../utils/format';

/**
 * TuTak Checkout — spec §5-6. Opened either from `tutak://checkout/<orderId>`
 * (a partner website redirecting the customer here) or from `MyOrdersScreen`.
 * Only TuTak ever sets an order PAID — this screen's "Pay" button is the one
 * and only place that happens for the customer, via `PartnerOrdersService.pay`.
 */
export function CheckoutScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Checkout'>>();
  const { orderId } = route.params;
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [insufficientBalance, setInsufficientBalance] = React.useState(false);

  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ['partner-order-checkout', orderId],
    queryFn: () => partnerOrderApi.getCheckout(orderId),
  });

  const { data: balance } = useQuery({
    queryKey: ['customer-balance'],
    queryFn: customerBalanceApi.getMyBalance,
  });

  const pay = useMutation({
    mutationFn: () => partnerOrderApi.pay(orderId),
    onSuccess: (result) => {
      if (result.insufficientBalance) {
        setInsufficientBalance(true);
        return;
      }
      setInsufficientBalance(false);
      queryClient.invalidateQueries({ queryKey: ['customer-balance'] });
      queryClient.invalidateQueries({ queryKey: ['partner-orders-mine'] });
      refetch();
    },
    onError: (err) => setError(describeApiError(err) ?? t('partnerOrder.insufficientBalance')),
  });

  if (isLoading || !order) {
    return (
      <Screen title={t('partnerOrder.checkoutTitle')}>
        <ActivityIndicator color={color.primary} />
      </Screen>
    );
  }

  const alreadyPaid = order.paymentStatus !== 'PAYMENT_PENDING';

  return (
    <Screen title={t('partnerOrder.checkoutTitle')}>
      <Surface style={{ marginBottom: space[4] }}>
        <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('partnerOrder.itemsLabel')}</Text>
        {order.items.map((item) => (
          <View
            key={item.id}
            style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}
          >
            <Text style={[text.body, { color: color.textPrimary }]}>
              {item.quantity}× {item.name}
            </Text>
            <Text style={[text.body, { color: color.textPrimary }]}>{formatAmd(item.totalPrice)}</Text>
          </View>
        ))}
      </Surface>

      <Surface style={{ marginBottom: space[4] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('partnerOrder.totalLabel')}</Text>
          <Text style={[text.headline, { color: color.textPrimary }]}>{formatAmd(order.totalAmount)}</Text>
        </View>
      </Surface>

      <Surface style={{ marginBottom: space[4] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('partnerOrder.balanceLabel')}</Text>
          <Text style={[text.body, { color: color.textPrimary }]}>
            {balance ? formatAmd(balance.balance) : '—'}
          </Text>
        </View>
      </Surface>

      {error ? (
        <Text style={[text.bodySm, { color: color.dangerText, marginBottom: space[3] }]}>{error}</Text>
      ) : null}

      {insufficientBalance ? (
        <Surface style={{ marginBottom: space[4] }}>
          <Text style={[text.bodySm, { color: color.dangerText }]}>{t('partnerOrder.insufficientBalance')}</Text>
          <View style={{ marginTop: space[3] }}>
            <Button
              label={t('partnerOrder.topUpCta')}
              variant="secondary"
              onPress={() => navigation.navigate('Wallet' as never)}
            />
          </View>
        </Surface>
      ) : null}

      {alreadyPaid ? (
        <Surface>
          <Text style={[text.body, { color: color.availableText }]}>{t('partnerOrder.paySuccess')}</Text>
        </Surface>
      ) : (
        <Button
          label={t('partnerOrder.payButton')}
          onPress={() => {
            setError(null);
            pay.mutate();
          }}
          loading={pay.isPending}
          icon={<JakoWingMark size={16} color={color.textInverse} />}
        />
      )}
    </Screen>
  );
}

