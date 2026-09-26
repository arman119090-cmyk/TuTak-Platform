'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, PageHeader, StatTile, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { settlementApi } from '@/lib/api/partnerOrderApi';

const num = (v: string | number | undefined | null) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

const KIND_LABEL: Record<string, string> = {
  'partner_order.completion': 'Online orders received by customers',
  'purchase_intent.money_release': 'QR purchases paid with TuTak money',
  'partner.bonus_redemption_compensation': 'Discounts customers used at your QR',
  'partner.contribution': 'TuTak commission',
  'partner.contribution_refund': 'Commission returned on refunds',
  'partner_order.return_money': 'Refunds of TuTak money',
  'partner_order.return_discount': 'Refunds of discounts',
  'partner_order.shortfall_settled_at_desk': 'Customer shortfall you kept at the desk',
  'partner_order.cancellation_cost': 'Approved cancellation costs',
  'purchase_intent.money_refund': 'QR refunds of TuTak money',
  'purchase_intent.shortfall_settled_at_desk': 'QR customer shortfall kept at the desk',
  'referral.withholding_recovered': 'Commission refunds repaid by referrers',
  'partner.settlement.paid': 'Settlement paid to you',
  'order_dispute.hold': 'Frozen for disputes',
  'order_dispute.release': 'Released from disputes',
  'payout.requested': 'Paid out to you',
  'partner.collection.recorded': 'Collected from you',
  'partner.collection.confirmed': 'Collected from you',
};

const CLASS_LABEL: Record<string, string> = {
  SETTLEABLE: 'Settled by TuTak',
  TRANSFER: 'Money moved',
  NOT_SETTLEABLE: 'Under review by TuTak',
};

/**
 * Spec §50, §77: what the partner is owed and owes, what is still reserved
 * for orders not yet received, and what is frozen by a dispute — plus a
 * statement per period of the partner's settlement cadence. Statements are
 * reports over TuTak's one settlement engine: every line shows the
 * settlement that pays it (see "Settlements"). There is deliberately no
 * "withdraw".
 */
export default function SettlementPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const [openAt, setOpenAt] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['settlement-summary', partnerId],
    queryFn: () => settlementApi.summary(partnerId!),
    enabled: !!partnerId,
  });
  const { data: statement } = useQuery({
    queryKey: ['settlement-statement', partnerId, openAt],
    queryFn: () => settlementApi.statement(partnerId!, openAt!),
    enabled: !!partnerId && !!openAt,
  });

  if (!summary) return <PageHeader title="Settlement" />;

  return (
    <>
      <PageHeader
        title="Settlement"
        description={`Your internal balance with TuTak, settled ${summary.settlementPeriodicity.toLowerCase()} by TuTak's settlement process — there is no manual withdrawal.`}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Due to you" value={`${num(summary.dueToPartner)} AMD`} />
        <StatTile label="Due to TuTak" value={`${num(summary.dueToTutak)} AMD`} />
        <StatTile label="In your next settlement" value={`${num(summary.unsettledNet)} AMD`} hint="Not yet claimed by a settlement" />
        <StatTile
          label="Reserved (not yet received)"
          value={`${num(summary.reservedInEscrow)} AMD`}
          hint={`Money ${num(summary.reservedMoneyInEscrow)} · discount ${num(summary.reservedDiscountInEscrow)} — released after customers confirm receipt`}
        />
        <StatTile
          label="Commission refunds on the way"
          value={`${num(summary.commissionRefundAwaitingWithholding)} AMD`}
          hint="From returned purchases: credited to you as the referrer's next bonuses repay what they had already spent"
        />
        <StatTile label="Frozen by disputes" value={`${num(summary.frozenForDisputes)} AMD`} />
        <StatTile label="Cash to confirm" value={`${num(summary.externalPaymentsAwaitingConfirmation)} AMD`} />
      </div>

      <Surface padded={false}>
        {summary.statements.length === 0 ? (
          <EmptyState title="No statements yet" message="A statement covers each closed period of your settlement cadence." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Opening</Th>
                <Th>Closing</Th>
                <Th>Settled</Th>
                <Th>Frozen</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {summary.statements.map((s) => (
                <Tr key={s.periodStart}>
                  <Td>
                    {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                  </Td>
                  <Td>{num(s.openingOwedToPartner)} AMD</Td>
                  <Td>{num(s.closingOwedToPartner)} AMD</Td>
                  <Td>{num(s.totals.claimedBySettlements)} AMD</Td>
                  <Td>{num(s.totals.frozenForDisputes)} AMD</Td>
                  <Td>
                    <Button size="sm" variant="tertiary" onClick={() => setOpenAt(openAt === s.periodStart ? null : s.periodStart)}>
                      {openAt === s.periodStart ? 'Hide' : 'Lines'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Surface>

      {statement ? (
        <Surface className="mt-6" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>What</Th>
                <Th>Reference</Th>
                <Th>Amount (+ owed to you)</Th>
                <Th>Settlement</Th>
              </tr>
            </thead>
            <tbody>
              {(statement.lines ?? []).map((line) => (
                <Tr key={line.postingId}>
                  <Td>{new Date(line.postedAt).toLocaleString()}</Td>
                  <Td>{KIND_LABEL[line.kind] ?? line.kind}</Td>
                  <Td>
                    {line.sourceType} {line.sourceId.slice(0, 8)}
                  </Td>
                  <Td>{num(line.owedToPartner)}</Td>
                  <Td>{line.settlementId ? `${line.settlementStatus} · ${line.settlementId.slice(0, 8)}` : CLASS_LABEL[line.classification]}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Surface>
      ) : null}
    </>
  );
}
