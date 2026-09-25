import React from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PartnerOrderDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { partnerOrderApi } from '../../../data/api/partnerOrderApi';
import { formatAmd } from '../../utils/format';

/**
 * Spec §18: "Мои заказы" — orders placed on a partner's own website through
 * TuTak Checkout. Deliberately shows only customer-facing status text (spec
 * §17: never "partner did not respond in 5 minutes", never an internal
 * escalation) — see `STATUS_KEY` below, which maps every `PartnerOrderStatus`
 * to one of a handful of neutral, reassuring phrases.
 */
const STATUS_KEY: Record<string, string> = {
  PAID: 'partnerOrder.statusPaid',
  PARTNER_SEEN: 'partnerOrder.statusPartnerSeen',
  STOCK_CONFIRMED: 'partnerOrder.statusStockConfirmed',
  OUT_OF_STOCK: 'partnerOrder.statusOutOfStock',
  SOURCING_REQUIRED: 'partnerOrder.statusSourcing',
  SOURCING_IN_PROGRESS: 'partnerOrder.statusSourcing',
  CUSTOMER_DECISION_REQUIRED: 'partnerOrder.statusCustomerDecision',
  ACCEPTED: 'partnerOrder.statusAccepted',
  PREPARING: 'partnerOrder.statusPreparing',
  READY: 'partnerOrder.statusReady',
  SHIPPED: 'partnerOrder.statusShipped',
  PICKUP_READY: 'partnerOrder.statusPickupReady',
  COMPLETED: 'partnerOrder.statusCompleted',
  CANCELLED: 'partnerOrder.statusCancelled',
  REFUNDED: 'partnerOrder.statusRefunded',
};

export function MyOrdersScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['partner-orders-mine'],
    queryFn: partnerOrderApi.listMine,
  });

  const renderItem = ({ item }: { item: PartnerOrderDto }) => {
    const needsAction =
      item.paymentStatus === 'PAYMENT_PENDING' || item.orderStatus === 'CUSTOMER_DECISION_REQUIRED';
    const card = (
      <Surface style={{ marginBottom: space[3] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>
            {t('partnerOrder.orderNumberLabel')} #{item.orderNumber}
          </Text>
          <Text style={[text.body, { color: color.textPrimary }]}>{formatAmd(item.totalAmount)}</Text>
        </View>
        <Text style={[text.body, { color: color.textPrimary, marginTop: space[2] }]}>
          {item.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
        </Text>
        <View
          style={{
            marginTop: space[3],
            alignSelf: 'flex-start',
            backgroundColor: color.pendingSurface,
            borderRadius: radius.full,
            paddingHorizontal: space[3],
            paddingVertical: space[1],
          }}
        >
          <Text style={[text.caption, { color: color.pendingText }]}>
            {t(STATUS_KEY[item.orderStatus] ?? 'partnerOrder.statusPaid')}
          </Text>
        </View>
      </Surface>
    );
    return needsAction ? (
      <Pressable onPress={() => navigation.navigate('Checkout', { orderId: item.id })}>{card}</Pressable>
    ) : (
      card
    );
  };

  return (
    <Screen title={t('partnerOrder.myOrdersTitle')}>
      {isLoading ? (
        <ActivityIndicator color={color.primary} />
      ) : !orders || orders.length === 0 ? (
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
            {t('partnerOrder.myOrdersEmpty')}
          </Text>
        </Surface>
      ) : (
        <FlatList data={orders} keyExtractor={(o) => o.id} renderItem={renderItem} />
      )}
    </Screen>
  );
}
