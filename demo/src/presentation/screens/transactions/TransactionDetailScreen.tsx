import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useRoute, type RouteProp } from '@react-navigation/native';
import {
  PaymentRoute,
  TransactionType,
  type PurchaseIntentDto,
  type PurchaseIntentRefundDto,
} from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { PartnerMark } from '../../components/PartnerMark';
import { Button } from '../../components/Button';
import { purchaseIntentApi } from '../../../data/api/purchaseIntentApi';
import { formatAmd, formatDateTime, formatPoints } from '../../utils/format';
import { moneyToString, parseMoney, subtract } from '../../../domain/money';

/**
 * One operation, opened (U05).
 *
 * Two sources, shown as two things. The row itself is what the history
 * already had: the brand as it was recorded, the amounts, the status. The
 * purchase behind it — its route, what has been refunded and the refunds
 * themselves — comes from the server on open, and until it arrives the
 * screen says so rather than showing "no refunds" for a purchase it has
 * not asked about.
 *
 * This is TuTak's record of the operation. It is not a fiscal receipt and
 * does not call itself one.
 */
export function TransactionDetailScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'TransactionDetail'>>();
  const tx = route.params.transaction;
  const intentId = tx.purchaseIntentId;

  const purchase = useQuery({
    queryKey: ['purchase-intent', intentId],
    queryFn: () => purchaseIntentApi.get(intentId!),
    enabled: !!intentId,
  });
  const refunds = useQuery({
    queryKey: ['purchase-intent', intentId, 'refunds'],
    queryFn: () => purchaseIntentApi.refunds(intentId!),
    enabled: !!intentId,
  });

  const isPurchase =
    tx.type === TransactionType.PARTNER_PURCHASE || tx.type === TransactionType.QR_PAYMENT;
  const gross = parseMoney(tx.amount);
  const bonusApplied = parseMoney(tx.bonusAppliedAmount);
  const realMoney = gross !== null && bonusApplied !== null ? subtract(gross, bonusApplied) : null;

  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: space[3],
      paddingVertical: space[2],
    },
    label: { ...text.bodySm, color: color.textSecondary, flexShrink: 1 },
    value: { ...text.bodySm, color: color.textPrimary, textAlign: 'right', flexShrink: 1 },
    section: { ...text.label, color: color.textSecondary, marginTop: space[5], marginBottom: space[2] },
    note: { ...text.bodySm, color: color.textSecondary, marginTop: space[4] },
    warning: { ...text.bodySm, color: color.pendingText },
  });

  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );

  return (
    <Screen title={t('history.detailTitle', 'Operation')}>
      <Surface>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          {tx.partnerBrand ? (
            <PartnerMark
              name={tx.partnerBrand.displayName}
              logoUrl={tx.partnerBrand.logo?.thumbnailUrl}
              size={44}
            />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {tx.partnerBrand?.displayName ??
                t(`transactionType.${tx.type}`, { defaultValue: tx.type })}
            </Text>
            <Text style={[text.bodySm, { color: color.textSecondary }]}>
              {t(`transactionType.${tx.type}`, { defaultValue: tx.type })} ·{' '}
              {t(`transactionStatus.${tx.status}`, { defaultValue: tx.status })}
            </Text>
          </View>
        </View>

        <Text style={styles.section}>{t('history.amounts', 'Amounts')}</Text>
        <Row label={t('history.date', 'Date')} value={formatDateTime(tx.createdAt)} />
        <Row
          label={isPurchase ? t('history.gross', 'Purchase total') : t('history.amount', 'Amount')}
          value={formatAmd(tx.amount)}
        />
        {isPurchase ? (
          <>
            <Row
              label={t('history.bonusApplied', 'Paid with bonus')}
              value={formatPoints(tx.bonusAppliedAmount)}
            />
            <Row
              label={t('history.realMoney', 'Paid in money')}
              value={realMoney !== null ? formatAmd(moneyToString(realMoney)) : '—'}
            />
          </>
        ) : null}
        <Row label={t('history.bonusEarned', 'Bonus earned')} value={formatPoints(tx.bonusEarnedAmount)} />

        {intentId ? (
          <>
            <Text style={styles.section}>{t('history.purchase', 'Purchase')}</Text>
            <PurchaseSection
              purchase={purchase.data}
              loading={purchase.isPending}
              failed={purchase.isError}
              staleSince={purchase.isError && purchase.data ? purchase.dataUpdatedAt : null}
              onRetry={() => void purchase.refetch()}
              styles={styles}
              Row={Row}
            />
            <Text style={styles.section}>{t('history.refunds', 'Refunds')}</Text>
            <RefundsSection
              refunds={refunds.data}
              loading={refunds.isPending}
              failed={refunds.isError}
              staleSince={refunds.isError && refunds.data ? refunds.dataUpdatedAt : null}
              onRetry={() => void refunds.refetch()}
              styles={styles}
            />
          </>
        ) : null}

        <Text style={styles.section}>{t('history.reference', 'Reference')}</Text>
        <Text style={[text.bodySm, { color: color.textSecondary }]} selectable>
          {tx.id}
        </Text>
        <Text style={styles.note}>
          {t('history.notReceipt', "This is TuTak's record of the operation, not a fiscal receipt.")}
        </Text>
      </Surface>
    </Screen>
  );
}

/**
 * Kept data whose refresh failed is shown, but never as current (audit D15):
 * the line names the time it was true and offers the retry. Without this a
 * purchase refunded a minute ago read "refunded so far: 0" off the cache.
 */
function StaleNotice({
  since,
  onRetry,
  styles,
}: {
  since: number | null;
  onRetry: () => void;
  styles: { warning: object };
}) {
  const { t } = useTranslation();
  if (since === null) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.warning} accessibilityRole="alert">
        {t('history.staleSince', {
          time: formatDateTime(new Date(since).toISOString()),
          defaultValue: 'Could not refresh. Showing what was known at {{time}}.',
        })}
      </Text>
      <Button label={t('common.retry')} variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

function PurchaseSection({
  purchase,
  loading,
  failed,
  staleSince,
  onRetry,
  styles,
  Row,
}: {
  purchase: PurchaseIntentDto | undefined;
  loading: boolean;
  failed: boolean;
  staleSince: number | null;
  onRetry: () => void;
  styles: { warning: object; label: object };
  Row: React.ComponentType<{ label: string; value: string }>;
}) {
  const { t } = useTranslation();
  if (purchase) {
    return (
      <>
        <StaleNotice since={staleSince} onRetry={onRetry} styles={styles} />
        <Row
          label={t('history.route', 'How it was paid')}
          value={
            purchase.paymentRoute === PaymentRoute.TUTAK_PSP
              ? t('history.routeProvider', 'Inside TuTak, through a payment provider')
              : t('history.routeTill', 'At the till')
          }
        />
        <Row
          label={t('history.status', 'Purchase state')}
          value={t(`history.purchaseStatus.${purchase.status}`, { defaultValue: purchase.status })}
        />
        {purchase.confirmationCode ? (
          <Row label={t('history.tillCode', 'Till code')} value={purchase.confirmationCode} />
        ) : null}
        <Row
          label={t('history.refundedTotal', 'Refunded so far')}
          value={formatAmd(purchase.refundedAmount)}
        />
      </>
    );
  }
  if (failed) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={styles.warning} accessibilityRole="alert">
          {t('history.purchaseFailed', 'The purchase behind this operation could not be loaded.')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" size="sm" onPress={onRetry} />
      </View>
    );
  }
  return <Text style={styles.label}>{loading ? t('common.loading') : ''}</Text>;
}

function RefundsSection({
  refunds,
  loading,
  failed,
  staleSince,
  onRetry,
  styles,
}: {
  refunds: PurchaseIntentRefundDto[] | undefined;
  loading: boolean;
  failed: boolean;
  staleSince: number | null;
  onRetry: () => void;
  styles: { warning: object; label: object; value: object; row: object };
}) {
  const { t } = useTranslation();
  if (refunds) {
    if (refunds.length === 0) {
      return (
        <>
          <StaleNotice since={staleSince} onRetry={onRetry} styles={styles} />
          <Text style={styles.label}>{t('history.noRefunds', 'No refunds on this purchase.')}</Text>
        </>
      );
    }
    return (
      <>
        <StaleNotice since={staleSince} onRetry={onRetry} styles={styles} />
        {refunds.map((refund) => (
          <View key={refund.id} style={styles.row}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.label}>{formatDateTime(refund.createdAt)}</Text>
              <Text style={styles.label}>{refund.reason}</Text>
            </View>
            <View>
              <Text style={styles.value}>{formatAmd(refund.amount)}</Text>
              {Number(refund.bonusRestored) > 0 ? (
                <Text style={styles.label}>
                  {t('history.bonusRestored', { amount: formatPoints(refund.bonusRestored), defaultValue: '+{{amount}} bonus back' })}
                </Text>
              ) : null}
              {Number(refund.prepaidRestored ?? '0') > 0 ? (
                <Text style={styles.label}>
                  {t('history.prepaidRestored', { amount: formatAmd(refund.prepaidRestored) })}
                </Text>
              ) : null}
              {/*
                The cash slice is the business's to hand back, and TuTak
                only knows what the business has said (§26). Until it says
                so, the refund is not complete for the customer — and the
                wording never gets ahead of the fact.
              */}
              {refund.externalRefundStatus === 'PENDING_PARTNER' ? (
                <Text style={styles.warning}>
                  {t('history.externalRefundPending', { amount: formatAmd(refund.externalRefundDue) })}
                </Text>
              ) : refund.externalRefundStatus === 'CONFIRMED' ? (
                <Text style={styles.label}>
                  {t('history.externalRefundConfirmed', { amount: formatAmd(refund.externalRefundDue) })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </>
    );
  }
  if (failed) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={styles.warning} accessibilityRole="alert">
          {t('history.refundsFailed', 'Refunds could not be loaded — this does not mean there are none.')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" size="sm" onPress={onRetry} />
      </View>
    );
  }
  return <Text style={styles.label}>{loading ? t('common.loading') : ''}</Text>;
}
