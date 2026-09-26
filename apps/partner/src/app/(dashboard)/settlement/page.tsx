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
  'purchase_intent.money_refund': 'QR refunds of TuTak money',
  'order_dispute.hold': 'Frozen for disputes',
  'order_dispute.release': 'Released from disputes',
  'payout.requested': 'Paid out to you',
  'partner.collection.recorded': 'Collected from you',
  'partner.collection.confirmed': 'Collected from you',
};

/**
 * Spec §50, §77: what the partner is owed and owes, what is still reserved
 * for orders not yet received, and what is frozen by a dispute — plus every
 * settlement statement, each line traceable to one ledger entry. There is
 * deliberately no "withdraw": TuTak settles through its own payout process.
 */
export default function SettlementPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['settlement-summary', partnerId],
    queryFn: () => settlementApi.summary(partnerId!),
    enabled: !!partnerId,
  });
  const { data: statement } = useQuery({
    queryKey: ['settlement-statement', openId],
    queryFn: () => settlementApi.statement(openId!),
    enabled: !!openId,
  });

  if (!summary) return <PageHeader title="Settlement" />;

  return (
    <>
      <PageHeader
        title="Settlement"
        description="Your internal balance with TuTak. It is settled by TuTak on your settlement period — there is no manual withdrawal."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Due to you" value={`${num(summary.dueToPartner)} AMD`} />
        <StatTile label="Due to TuTak" value={`${num(summary.dueToTutak)} AMD`} />
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
          <EmptyState title="No statements yet" message="A statement is generated at the end of each settlement period." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Opening</Th>
                <Th>Closing</Th>
                <Th>Frozen</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {summary.statements.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                  </Td>
                  <Td>{num(-Number(s.openingBalance))} AMD</Td>
                  <Td>{num(-Number(s.closingBalance))} AMD</Td>
                  <Td>{num(-Number(s.frozenBalance))} AMD</Td>
                  <Td>
                    <Button size="sm" variant="tertiary" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      {openId === s.id ? 'Hide' : 'Lines'}
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
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <Tr key={line.id}>
                  <Td>{new Date(line.postedAt).toLocaleString()}</Td>
                  <Td>{KIND_LABEL[line.kind] ?? line.kind}</Td>
                  <Td>
                    {line.sourceType} {line.sourceId.slice(0, 8)}
                  </Td>
                  <Td>{num(-Number(line.signedAmount))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Surface>
      ) : null}
    </>
  );
}
