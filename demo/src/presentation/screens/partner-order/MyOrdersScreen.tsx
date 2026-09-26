import React from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CustomerPartnerOrderDto, PartnerOrderAdjustmentDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { partnerOrderApi } from '../../../data/api/partnerOrderApi';
import { describeApiError } from '../../../data/api/errors';
import { formatAmd } from '../../utils/format';

/**
 * "Мои заказы" (spec §31-34, §43, §48, §69). Every status shown is the
 * neutral `customerStatus` the server derives — never the partner's
 * internal SLA state (spec §19). "Получил заказ" appears only once the
 * partner confirmed stock (spec §31) and always asks a second time (§32).
 */
export function MyOrdersScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: orders, isLoading } = useQuery({
    queryKey: ['partner-orders-mine'],
    queryFn: partnerOrderApi.listMine,
  });

  return (
    <Screen title={t('partnerOrder.myOrdersTitle')} scroll={false}>
      {isLoading ? (
        <ActivityIndicator color={color.primary} />
      ) : !orders || orders.length === 0 ? (
        <Text style={[text.body, { color: color.textSecondary }]}>{t('partnerOrder.myOrdersEmpty')}</Text>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          renderItem={({ item }) => (
            <OrderCard order={item} onOpenCheckout={() => navigation.navigate('Checkout', { orderId: item.id })} />
          )}
        />
      )}
    </Screen>
  );
}

function OrderCard({ order, onOpenCheckout }: { order: CustomerPartnerOrderDto; onOpenCheckout: () => void }) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-orders-mine'] });
    queryClient.invalidateQueries({ queryKey: ['customer-balance'] });
  };
  const onError = (err: unknown) => setError(describeApiError(err) ?? t('common.somethingWentWrong'));

  const received = useMutation({ mutationFn: () => partnerOrderApi.confirmReceived(order.id), onSuccess: refresh, onError });
  const cancel = useMutation({ mutationFn: () => partnerOrderApi.cancel(order.id), onSuccess: refresh, onError });
  const withdrawCancel = useMutation({ mutationFn: () => partnerOrderApi.withdrawCancel(order.id), onSuccess: refresh, onError });
  const disputeShortfall = useMutation({
    mutationFn: (returnId: string) => partnerOrderApi.disputeReturnShortfall(returnId, 'Customer disagrees with the amount'),
    onSuccess: () => {
      Alert.alert(t('partnerOrder.returnDisputed'));
      refresh();
    },
    onError,
  });
  const dispute = useMutation({
    mutationFn: (reason: string) => partnerOrderApi.openDispute(order.id, reason),
    onSuccess: () => {
      setProblem(null);
      Alert.alert(t('partnerOrder.disputeSent'));
      refresh();
    },
    onError,
  });

  const pending = order.adjustments.find((a) => a.status === 'PENDING_CUSTOMER');
  const cancellation = (order.cancellations ?? []).slice(-1)[0];
  const returns = order.returns ?? [];

  const line = (label: string) => <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>{label}</Text>;

  return (
    <Surface>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[text.label, { color: color.textPrimary }]}>
          {t('partnerOrder.orderNumberLabel')} #{order.orderNumber}
        </Text>
        <Text style={[text.label, { color: color.textPrimary }]}>{formatAmd(order.totalAmount)}</Text>
      </View>
      <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}>
        {t(`partnerOrder.status_${order.customerStatus}`)}
      </Text>
      {order.items.slice(0, 3).map((item) => line(`${item.quantity}× ${item.name}`))}
      {Number(order.discountAmount) > 0 ? line(t('partnerOrder.paidDiscount', { amount: formatAmd(order.discountAmount) })) : null}
      {Number(order.tutakMoneyAmount) > 0 ? line(t('partnerOrder.paidMoney', { amount: formatAmd(order.tutakMoneyAmount) })) : null}
      {Number(order.externalAmount) > 0 ? line(t('partnerOrder.paidExternal', { amount: formatAmd(order.externalAmount) })) : null}
      {order.courierNote && order.customerStatus === 'on_the_way' ? line(t('partnerOrder.courierNote', { note: order.courierNote })) : null}
      {cancellation?.status === 'COST_REVIEW' && cancellation.claimedCostAmount
        ? line(t('partnerOrder.cancellationCostClaimed', { amount: formatAmd(cancellation.claimedCostAmount), reason: cancellation.costReason ?? '' }))
        : null}
      {cancellation?.status === 'COMPLETED' && Number(cancellation.approvedCostAmount) > 0
        ? line(t('partnerOrder.cancellationDecided', { amount: formatAmd(cancellation.approvedCostAmount) }))
        : null}
      {returns.map((r) => (
        <View key={r.id}>
          {line(t('partnerOrder.returnBreakdown', { gross: formatAmd(r.grossRefund), recovered: formatAmd(r.recoveredShortfall), net: formatAmd(r.netRefund) }))}
          {r.status === 'AWAITING_SHORTFALL_SETTLEMENT' ? (
            <>
              {line(t('partnerOrder.returnSettleAtDesk', { amount: formatAmd(r.shortfallAmount) }))}
              <View style={{ marginTop: space[2] }}>
                <Button
                  label={t('partnerOrder.returnDisputeButton')}
                  variant="tertiary"
                  size="sm"
                  loading={disputeShortfall.isPending}
                  onPress={() => disputeShortfall.mutate(r.id)}
                />
              </View>
            </>
          ) : null}
          {r.status === 'MANUAL_REVIEW' ? line(t('partnerOrder.returnDisputed')) : null}
        </View>
      ))}

      {pending ? <ProposalBlock order={order} proposal={pending} onDone={refresh} /> : null}

      {error ? <Text style={[text.bodySm, { color: color.dangerText, marginTop: space[2] }]}>{error}</Text> : null}

      <View style={{ marginTop: space[3], gap: space[2] }}>
        {order.customerStatus === 'awaiting_confirmation' ? (
          <Button label={t('partnerOrder.confirmButton')} onPress={onOpenCheckout} size="sm" />
        ) : null}
        {order.canConfirmReceipt ? (
          <Button
            label={t('partnerOrder.receivedButton')}
            size="sm"
            loading={received.isPending}
            onPress={() =>
              Alert.alert(t('partnerOrder.receivedConfirmTitle'), t('partnerOrder.receivedConfirmBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('partnerOrder.receivedConfirmYes'), onPress: () => received.mutate() },
              ])
            }
          />
        ) : null}
        {order.canCancel && order.customerStatus !== 'awaiting_confirmation' ? (
          <Button
            label={t('partnerOrder.cancelButton')}
            variant="secondary"
            size="sm"
            loading={cancel.isPending}
            onPress={() =>
              Alert.alert(t('partnerOrder.cancelButton'), t('partnerOrder.cancelConfirmBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.confirm'), style: 'destructive', onPress: () => cancel.mutate() },
              ])
            }
          />
        ) : null}
        {order.canWithdrawCancellation ? (
          <Button
            label={t('partnerOrder.withdrawCancelButton')}
            variant="secondary"
            size="sm"
            loading={withdrawCancel.isPending}
            onPress={() => withdrawCancel.mutate()}
          />
        ) : null}
        {order.canOpenDispute && order.disputeStatus !== 'OPEN' ? (
          problem === null ? (
            <Button label={t('partnerOrder.disputeButton')} variant="tertiary" size="sm" onPress={() => setProblem('')} />
          ) : (
            <View>
              <TextField label={t('partnerOrder.disputeButton')} placeholder={t('partnerOrder.disputeReasonPlaceholder')} value={problem} onChangeText={setProblem} />
              <View style={{ height: space[2] }} />
              <Button
                label={t('common.confirm')}
                size="sm"
                disabled={problem.trim().length < 2}
                loading={dispute.isPending}
                onPress={() => dispute.mutate(problem.trim())}
              />
            </View>
          )
        ) : null}
      </View>
    </Surface>
  );
}

/** Spec §39-41: a sourcing proposal — nothing continues without the customer's explicit yes. */
function ProposalBlock({
  order,
  proposal,
  onDone,
}: {
  order: CustomerPartnerOrderDto;
  proposal: PartnerOrderAdjustmentDto;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const [money, setMoney] = React.useState(proposal.deltaAmount);
  const [error, setError] = React.useState<string | null>(null);
  const delta = Number(proposal.deltaAmount);
  const accept = useMutation({
    mutationFn: () =>
      partnerOrderApi.acceptAdjustment(proposal.id, delta > 0 ? { tutakMoneyAmount: money, idempotencyKey: `adj-${proposal.id}-${money}` } : {}),
    onSuccess: onDone,
    onError: (err) => setError(describeApiError(err) ?? t('common.somethingWentWrong')),
  });
  const decline = useMutation({ mutationFn: () => partnerOrderApi.declineAdjustment(proposal.id), onSuccess: onDone });

  return (
    <View style={{ marginTop: space[3], padding: space[3], borderRadius: 12, backgroundColor: color.surfaceSunken }}>
      <Text style={[text.label, { color: color.textPrimary }]}>{t('partnerOrder.proposalTitle')}</Text>
      <Text style={[text.bodySm, { color: color.textPrimary, marginTop: space[1] }]}>
        {proposal.type === 'SAME_ITEM_OTHER_SOURCE' ? t('partnerOrder.proposalSameItem') : t('partnerOrder.proposalAlternate')}
        {proposal.description ? ` — ${proposal.description}` : ''}
      </Text>
      {proposal.details?.differences ? (
        <Text style={[text.caption, { color: color.textSecondary }]}>
          {t('partnerOrder.proposalDifferences', { text: proposal.details.differences })}
        </Text>
      ) : null}
      <Text style={[text.bodySm, { color: color.textPrimary, marginTop: space[1] }]}>
        {formatAmd(order.totalAmount)} → {formatAmd(proposal.newTotalAmount)}
      </Text>
      {delta < 0 ? <Text style={[text.caption, { color: color.availableText }]}>{t('partnerOrder.proposalCheaper', { amount: formatAmd(-delta) })}</Text> : null}
      {delta > 0 ? (
        <>
          <Text style={[text.caption, { color: color.textSecondary }]}>{t('partnerOrder.proposalMoreExpensive', { amount: formatAmd(delta) })}</Text>
          <TextField label={t('partnerOrder.moneyLabel')} keyboardType="number-pad" value={money} onChangeText={setMoney} />
        </>
      ) : null}
      {error ? <Text style={[text.bodySm, { color: color.dangerText }]}>{error}</Text> : null}
      <View style={{ marginTop: space[2], gap: space[2] }}>
        <Button label={t('partnerOrder.acceptButton')} size="sm" loading={accept.isPending} onPress={() => accept.mutate()} />
        <Button label={t('partnerOrder.declineButton')} size="sm" variant="secondary" loading={decline.isPending} onPress={() => decline.mutate()} />
      </View>
    </View>
  );
}
