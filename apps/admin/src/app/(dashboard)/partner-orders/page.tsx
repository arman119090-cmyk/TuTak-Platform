'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPartnerOrderDto, PartnerOrderAdminQueue } from '@tutak/shared-types';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { apiErrorMessage, partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

const QUEUES: { key: PartnerOrderAdminQueue; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'not_seen', label: 'Not seen > 5 min' },
  { key: 'stock_not_confirmed', label: 'Stock not confirmed > 30 min' },
  { key: 'critical', label: 'Critical' },
  { key: 'sourcing_required', label: 'Sourcing required' },
  { key: 'searching', label: 'Searching' },
  { key: 'customer_action', label: 'Customer action required' },
  { key: 'payment_issue', label: 'Payment issue' },
  { key: 'refund_required', label: 'Refund required' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'manual_review', label: 'Manual review' },
  { key: 'completed', label: 'Completed' },
];

/** Spec §76: the operator should never read a raw enum. */
const WHERE: Record<string, string> = {
  SUBMITTED: 'Waiting for the partner to open it',
  SEEN: 'Partner saw it, stock not confirmed',
  STOCK_CONFIRMED: 'In stock, not handed over yet',
  OUT_OF_STOCK: 'Out of stock',
  HANDED_OVER: 'Handed over, customer has not confirmed',
  RECEIVED: 'Customer received it',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const MONEY: Record<string, string> = {
  UNFUNDED: 'Nothing paid',
  RESERVED: 'Held by TuTak, cash pending',
  FUNDED: 'Fully secured',
  PARTIALLY_FUNDED: 'Partly secured',
  SETTLED: 'Released to partner',
  REFUND_PENDING: 'Refund in progress',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

function elapsed(from: string | null, now: number) {
  if (!from) return '—';
  const minutes = Math.floor((now - +new Date(from)) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} days`;
}

/**
 * Spec §55, §76: every Partner Commerce order that needs a TuTak operator —
 * where it is stuck, for how long, who the partner is (to call them), how
 * much, and the state of the money. Manual review lets an operator record
 * a receipt the customer confirmed by phone, or cancel — never a timer.
 */
export default function PartnerOrdersQueuePage() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<PartnerOrderAdminQueue>('not_seen');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery({
    queryKey: ['partner-order-queue', queue],
    queryFn: () => partnerOrderAdminApi.queue(queue),
    refetchInterval: 15_000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['partner-order-queue'] });

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      void invalidate();
    } catch (err) {
      setError(apiErrorMessage(err, 'Action failed'));
    }
  };

  const orders: AdminPartnerOrderDto[] = data ?? [];

  return (
    <>
      <PageHeader title="Partner orders" description="Online orders from partner websites that need attention. Elapsed time is counted from the customer's confirmation." />
      <div className="mb-4 flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <Button key={q.key} size="sm" variant={queue === q.key ? 'primary' : 'secondary'} onClick={() => setQueue(q.key)}>
            {q.label}
          </Button>
        ))}
      </div>
      {error ? <div className="mb-3 text-[13px] text-danger-text">{error}</div> : null}
      {orders.length === 0 ? (
        <EmptyState title="Nothing here" message="Orders appear here automatically when they match this queue." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Partner · branch</Th>
              <Th align="right">Amount</Th>
              <Th>Where it is</Th>
              <Th>Money</Th>
              <Th>Elapsed</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <Tr key={o.id}>
                <Td className="font-mono text-[12px]">
                  #{o.orderNumber}
                  <div className="text-faint">{o.customer ? `${o.customer.firstName ?? ''} ${o.customer.lastName ?? ''} ${o.customer.phone ?? ''}` : ''}</div>
                </Td>
                <Td>
                  {o.partner.displayName}
                  <div className="text-[12px] text-muted">{o.branch ? `${o.branch.name}, ${o.branch.address}` : 'no branch'}</div>
                </Td>
                <Td align="right" className="tabular">
                  {Number(o.totalAmount).toLocaleString('en-US')} ֏
                </Td>
                <Td>
                  {WHERE[o.operationalStatus] ?? o.operationalStatus}
                  {o.sourcingStatus !== 'NONE' ? <div className="text-[12px] text-muted">Sourcing: {o.sourcingStatus.toLowerCase().replace(/_/g, ' ')}</div> : null}
                  {o.disputeStatus === 'OPEN' ? <Badge tone="danger">dispute</Badge> : null}
                  {o.manualReviewReason ? <div className="text-[12px] text-danger-text">Review: {o.manualReviewReason.replace(/_/g, ' ')}</div> : null}
                  {o.escalations.some((e) => !e.resolvedAt && e.claimedByUserId) ? <Badge tone="pending">taken into work</Badge> : null}
                </Td>
                <Td>{MONEY[o.paymentStatus] ?? o.paymentStatus}</Td>
                <Td className="text-muted">{elapsed(o.submittedAt, now)}</Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    {o.escalations
                      .filter((e) => !e.resolvedAt && !e.claimedByUserId)
                      .slice(0, 1)
                      .map((e) => (
                        <Button key={e.id} size="sm" variant="secondary" onClick={() => act(() => partnerOrderAdminApi.claimEscalation(e.id))}>
                          Take into work
                        </Button>
                      ))}
                    {['STOCK_CONFIRMED', 'HANDED_OVER'].includes(o.operationalStatus) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const reason = window.prompt('How was the receipt confirmed? (recorded in the audit log)');
                          if (reason) void act(() => partnerOrderAdminApi.confirmReceived(o.id, reason));
                        }}
                      >
                        Record receipt
                      </Button>
                    ) : null}
                    {['SUBMITTED', 'SEEN', 'STOCK_CONFIRMED', 'OUT_OF_STOCK'].includes(o.operationalStatus) ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const reason = window.prompt('Why cancel? The customer gets everything paid through TuTak back.');
                          if (reason) void act(() => partnerOrderAdminApi.cancelOrder(o.id, reason));
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
