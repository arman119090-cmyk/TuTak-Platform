'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { financeApi } from '@/lib/api/financeApi';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONE = {
  REQUESTED: 'pending',
  PAID: 'available',
  FAILED: 'danger',
} as const;

/**
 * A partner's own money: what they are owed now, the real purchase activity
 * that built it up, and every transfer between them and TuTak in either
 * direction.
 *
 * Read-only by design — a partner cannot initiate their own payout or record
 * their own collection. The balance shown here is the same figure the
 * platform pays against, read from the same ledger account, so there is no
 * second number to disagree with.
 */
export default function EarningsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data: balance } = useQuery({
    queryKey: ['partner-balance', partnerId],
    queryFn: () => financeApi.balance(partnerId!),
    enabled: !!partnerId,
  });
  // The legacy card-payment daily rollup. Empty for every partner running
  // only the live QR flow, since `CARD_PAYMENTS_ENABLED` stays off in
  // production — kept for the partners who do have real card activity,
  // rather than removed outright.
  const { data: settlements } = useQuery({
    queryKey: ['partner-settlements', partnerId],
    queryFn: () => financeApi.settlements(partnerId!),
    enabled: !!partnerId,
  });
  // The real source for a QR-only partner: confirmed PurchaseIntents,
  // grouped by day, straight from the ledger postings that built the
  // balance above.
  const { data: activity } = useQuery({
    queryKey: ['partner-activity', partnerId],
    queryFn: () => financeApi.dailyActivity(partnerId!),
    enabled: !!partnerId,
  });
  const { data: payouts } = useQuery({
    queryKey: ['partner-payouts', partnerId],
    queryFn: () => financeApi.payouts(partnerId!),
    enabled: !!partnerId,
  });
  const { data: collections } = useQuery({
    queryKey: ['partner-collections', partnerId],
    queryFn: () => financeApi.collections(partnerId!),
    enabled: !!partnerId,
  });

  const days = settlements ?? [];
  const activityDays = activity ?? [];
  const transfers = payouts ?? [];
  const collected = collections ?? [];

  // Lifetime figures combine both pipelines, so a partner who moved between
  // them (or ran both at once) sees one true total rather than two partial
  // ones with no obvious relationship to each other.
  const lifetimeGross =
    days.reduce((acc, s) => acc + Number(s.grossAmount), 0) +
    activityDays.reduce((acc, d) => acc + Number(d.grossAmount), 0);
  const lifetimeCommission =
    days.reduce((acc, s) => acc + Number(s.commissionAmount), 0) +
    activityDays.reduce((acc, d) => acc + Number(d.commissionOwedAmount), 0);

  if (!partnerId) {
    return (
      <EmptyState
        title="No partner linked"
        message="This account is not scoped to a partner, so there are no earnings to show."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Earnings"
        description="What you are owed, the purchase activity behind it, and every transfer between you and TuTak."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Available to pay out"
          value={balance ? `${money(balance.availableBalance)} AMD` : '—'}
        />
        <StatTile label="Gross, lifetime" value={`${money(String(lifetimeGross))} AMD`} />
        <StatTile label="Commission, lifetime" value={`${money(String(lifetimeCommission))} AMD`} />
      </div>

      <h2 className="mt-8 text-[15px] font-semibold text-ink">QR purchase activity</h2>
      <div className="mt-3">
        {activityDays.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            message="Confirmed QR purchases appear here the day they are confirmed."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Gross</Th>
                <Th align="right">Discount given</Th>
                <Th align="right">Commission owed</Th>
                <Th align="right">Net</Th>
                <Th align="right">Purchases</Th>
              </tr>
            </thead>
            <tbody>
              {activityDays.map((d) => (
                <Tr key={d.periodStart}>
                  <Td className="font-medium text-ink">{d.periodStart.slice(0, 10)}</Td>
                  <Td align="right" className="tabular">
                    {money(d.grossAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(d.discountGivenAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {money(d.commissionOwedAmount)}
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(d.netAmount)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {d.purchaseCount}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {days.length > 0 && (
        <>
          <h2 className="mt-8 text-[15px] font-semibold text-ink">Daily settlements (card payments)</h2>
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th align="right">Gross</Th>
                  <Th align="right">Commission</Th>
                  <Th align="right">Net</Th>
                  <Th align="right">Payments</Th>
                  <Th align="right">Points issued</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium text-ink">{s.periodStart.slice(0, 10)}</Td>
                    <Td align="right" className="tabular">
                      {money(s.grossAmount)}
                    </Td>
                    <Td align="right" className="tabular text-muted">
                      {money(s.commissionAmount)}
                    </Td>
                    <Td align="right" className="tabular font-medium text-ink">
                      {money(s.netAmount)}
                    </Td>
                    <Td align="right" className="tabular text-muted">
                      {s.paymentCount}
                    </Td>
                    <Td align="right" className="tabular text-muted">
                      {money(s.bonusAccrued)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Payouts</h2>
      <div className="mt-3">
        {transfers.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            message="Transfers to your bank account will be listed here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th>Requested</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((p) => (
                <Tr key={p.id}>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(p.amount)}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="tabular text-[12px] text-muted">
                    {p.bankReference ?? p.failureReason ?? '—'}
                  </Td>
                  <Td className="text-muted">{new Date(p.createdAt).toLocaleDateString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <h2 className="mt-8 text-[15px] font-semibold text-ink">Collections</h2>
      <div className="mt-3">
        {collected.length === 0 ? (
          <EmptyState
            title="No collections yet"
            message="Transfers you send TuTak to settle a balance in their favor will be listed here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Amount</Th>
                <Th>Reference</Th>
                <Th>Recorded</Th>
              </tr>
            </thead>
            <tbody>
              {collected.map((c) => (
                <Tr key={c.id}>
                  <Td align="right" className="tabular font-medium text-ink">
                    {money(c.amount)}
                  </Td>
                  <Td className="tabular text-[12px] text-muted">{c.bankReference}</Td>
                  <Td className="text-muted">{new Date(c.createdAt).toLocaleDateString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
