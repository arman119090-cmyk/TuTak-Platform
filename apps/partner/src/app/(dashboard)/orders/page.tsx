'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerOrderDto, PartnerOrderQueueFilter } from '@tutak/shared-types';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { apiErrorMessage, partnerOrderApi } from '@/lib/api/partnerOrderApi';

const num = (v: string | number | undefined | null) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

/** Spec §53: plain words, never internal enums. */
const FILTERS: { key: PartnerOrderQueueFilter | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'seen', label: 'Seen' },
  { key: 'stock_confirmed', label: 'Stock confirmed' },
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'handed_over', label: 'Handed over' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'refund', label: 'Refunds' },
  { key: 'dispute', label: 'Disputes' },
];

const STATUS: Record<string, { label: string; tone: 'pending' | 'available' | 'danger' | 'neutral' }> = {
  SUBMITTED: { label: 'New order', tone: 'danger' },
  SEEN: { label: 'Check stock', tone: 'pending' },
  STOCK_CONFIRMED: { label: 'In stock — prepare and hand over', tone: 'available' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'neutral' },
  HANDED_OVER: { label: 'Handed over', tone: 'available' },
  RECEIVED: { label: 'Customer received it', tone: 'available' },
  COMPLETED: { label: 'Completed', tone: 'available' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const LEG_LABEL: Record<string, string> = {
  DISCOUNT: 'Discount (paid by TuTak)',
  TUTAK_MONEY: 'TuTak money (held by TuTak)',
  EXTERNAL: 'Paid to you directly',
};

const LEG_STATUS: Record<string, string> = {
  PENDING: 'awaiting confirmation',
  CAPTURED: 'secured',
  CONFIRMED: 'confirmed',
  CORRECTED: 'corrected',
  SETTLED: 'settled',
  RETURN_PENDING: 'to be returned by you',
  RETURNED: 'returned',
};

/**
 * Spec §53-54, §75: the partner's order desk. A new order shows one button
 * ("Увидел"), then "В наличии / Нет в наличии", then "Передан". Cash and
 * other direct payments are confirmed here by an employee on shift;
 * electronic payments are never the partner's to mark (spec §59), and there
 * is no field anywhere to change an amount or a commission.
 */
export default function OrdersPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const [filter, setFilter] = useState<PartnerOrderQueueFilter | 'all'>('all');

  const { data: orders } = useQuery({
    queryKey: ['partner-orders', partnerId, filter],
    queryFn: () => partnerOrderApi.list(partnerId!, filter === 'all' ? undefined : filter),
    enabled: !!partnerId,
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader
        title="Orders"
        description="Orders customers confirmed on your website through TuTak. Tap “Seen” first, then say whether it is in stock. Money paid through TuTak is released to you after the customer confirms receipt."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? 'primary' : 'secondary'} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>
      {(orders ?? []).length === 0 ? (
        <EmptyState title="No orders here" message="New orders appear the moment a customer confirms them." />
      ) : (
        <div className="grid gap-4">
          {(orders ?? []).map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </>
  );
}

function OrderCard({ order }: { order: PartnerOrderDto }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [disputeType, setDisputeType] = useState<'ORDER' | 'PAYMENT'>('PAYMENT');
  const [disputeReason, setDisputeReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['partner-orders'] });
  const run = <T,>(fn: () => Promise<T>) =>
    fn()
      .then(() => {
        setError(null);
        void refresh();
      })
      .catch((err) => setError(apiErrorMessage(err, 'Something went wrong')));

  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => run(fn) });
  const status = STATUS[order.operationalStatus] ?? { label: order.operationalStatus, tone: 'neutral' as const };
  const minutes = order.submittedAt ? Math.floor((Date.now() - +new Date(order.submittedAt)) / 60_000) : 0;
  const pendingExternal = order.paymentLegs.filter((l) => l.type === 'EXTERNAL' && l.status === 'PENDING');
  const confirmedExternal = order.paymentLegs.filter((l) => l.type === 'EXTERNAL' && l.status === 'CONFIRMED');
  const returnPending = order.paymentLegs.filter((l) => l.status === 'RETURN_PENDING');
  const beforeHandover = ['SUBMITTED', 'SEEN', 'STOCK_CONFIRMED'].includes(order.operationalStatus);
  const afterHandover = ['HANDED_OVER', 'RECEIVED', 'COMPLETED'].includes(order.operationalStatus);

  return (
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] text-muted">
            #{order.orderNumber} · {minutes > 0 ? `${minutes} min ago` : 'just now'}
          </div>
          <div className="text-[20px] font-semibold text-ink">{num(order.totalAmount)} AMD</div>
        </div>
        <div className="flex gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {order.disputeStatus === 'OPEN' ? <Badge tone="danger">Dispute open</Badge> : null}
        </div>
      </div>

      <ul className="mt-3 text-[14px] text-ink">
        {order.items.map((item) => (
          <li key={item.id}>
            {item.quantity}× {item.name}
            {item.sku ? ` · ${item.sku}` : ''}
            {item.oemNumber ? ` · OEM ${item.oemNumber}` : ''} — {num(item.totalPrice)} AMD
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-1 text-[13px] text-muted">
        {order.paymentLegs.map((leg) => (
          <div key={leg.id}>
            {LEG_LABEL[leg.type]}: {num(Number(leg.amount) - Number(leg.refundedAmount))} AMD — {LEG_STATUS[leg.status] ?? leg.status}
          </div>
        ))}
        <div>
          Commission {order.commissionRateBps / 100}%: {num(order.commissionAmount)} AMD
        </div>
      </div>

      {error ? <div className="mt-3 text-[13px] text-danger-text">{error}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {order.operationalStatus === 'SUBMITTED' ? (
          <Button loading={action.isPending} onClick={() => action.mutate(() => partnerOrderApi.markSeen(order.id))}>
            Seen
          </Button>
        ) : null}
        {['SUBMITTED', 'SEEN'].includes(order.operationalStatus) ? (
          <>
            <Button variant="primary" onClick={() => action.mutate(() => partnerOrderApi.confirmStock(order.id))}>
              In stock
            </Button>
            <Button variant="secondary" onClick={() => setRejecting(true)}>
              Out of stock
            </Button>
          </>
        ) : null}
        {order.operationalStatus === 'OUT_OF_STOCK' && ['REQUIRED', 'SEARCHING'].includes(order.sourcingStatus) ? (
          <Button variant="secondary" onClick={() => action.mutate(() => partnerOrderApi.confirmStock(order.id))}>
            Found it — in stock
          </Button>
        ) : null}
        {order.operationalStatus === 'STOCK_CONFIRMED' ? (
          <Button onClick={() => action.mutate(() => partnerOrderApi.handedOver(order.id))}>Handed over</Button>
        ) : null}
        {pendingExternal.map((leg) => (
          <Button key={leg.id} variant="primary" onClick={() => action.mutate(() => partnerOrderApi.confirmExternal(leg.id))}>
            Confirm payment received: {num(Number(leg.amount) - Number(leg.refundedAmount))} AMD
          </Button>
        ))}
        {beforeHandover
          ? confirmedExternal.map((leg) => (
              <Button
                key={leg.id}
                variant="tertiary"
                onClick={() => {
                  const why = window.prompt('Why is this payment confirmation wrong? (owner/manager only)');
                  if (why) action.mutate(() => partnerOrderApi.correctExternal(leg.id, why));
                }}
              >
                Correct confirmation
              </Button>
            ))
          : null}
        {returnPending.map((leg) => (
          <Button key={leg.id} variant="secondary" onClick={() => action.mutate(() => partnerOrderApi.confirmExternalReturn(leg.id))}>
            Confirm cash returned: {num(leg.amount)} AMD
          </Button>
        ))}
        {(order.returns ?? [])
          .filter((r) => r.status === 'PENDING_EXTERNAL_REFUND')
          .map((r) => (
            <Button key={r.id} variant="secondary" onClick={() => action.mutate(() => partnerOrderApi.confirmReturnExternalRefund(r.id))}>
              Confirm refund handed back: {num(r.externalRefundDue)} AMD
            </Button>
          ))}
      </div>

      {rejecting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
          <Button
            variant="destructive"
            onClick={() =>
              action.mutate(async () => {
                await partnerOrderApi.rejectStock(order.id, { reason: reason || undefined });
                setRejecting(false);
              })
            }
          >
            Confirm out of stock
          </Button>
          <Button variant="tertiary" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {order.operationalStatus === 'COMPLETED' && order.paymentStatus !== 'REFUNDED' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-[13px] text-muted">Return:</span>
          <Input value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} placeholder="Amount (empty = full)" />
          <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Reason" />
          <Button
            variant="secondary"
            disabled={returnReason.trim().length < 3}
            onClick={() =>
              action.mutate(() =>
                partnerOrderApi.createReturn(order.id, {
                  amount: returnAmount.trim() || undefined,
                  reason: returnReason.trim(),
                  idempotencyKey: `return-${order.id}-${returnAmount.trim() || 'full'}-${order.refundedAmount}`,
                }),
              )
            }
          >
            Register return
          </Button>
        </div>
      ) : null}

      {afterHandover && order.disputeStatus !== 'OPEN' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Problem:</span>
          <Select value={disputeType} onChange={(e) => setDisputeType(e.target.value as 'ORDER' | 'PAYMENT')} className="w-auto">
            <option value="PAYMENT">Payment not received</option>
            <option value="ORDER">Other order problem</option>
          </Select>
          <Input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="What happened?" />
          <Button
            variant="tertiary"
            disabled={disputeReason.trim().length < 2}
            onClick={() => action.mutate(() => partnerOrderApi.openDispute(order.id, { type: disputeType, reason: disputeReason.trim() }))}
          >
            Open dispute
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
