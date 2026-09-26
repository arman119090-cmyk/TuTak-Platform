'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDisputeDto } from '@tutak/shared-types';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Surface } from '@tutak/design/web';
import { apiErrorMessage, partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

const num = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Spec §29, §48-49: every open dispute with what an operator needs to
 * decide — order, amount, customer, partner, who confirmed what and when,
 * the reason and the evidence. Only a TuTak admin decides; the decision is
 * idempotent (a second click, or a second admin, changes nothing) and goes
 * to the audit log. A frozen amount is released first; a refund to the
 * customer then runs as a proportional return.
 */
export default function PartnerOrderDisputesPage() {
  const { data } = useQuery({ queryKey: ['order-disputes'], queryFn: partnerOrderAdminApi.listDisputes, refetchInterval: 20_000 });
  const disputes = data ?? [];
  return (
    <>
      <PageHeader title="Order disputes" description="Customer order problems and partner payment disputes waiting for a TuTak decision." />
      {disputes.length === 0 ? (
        <EmptyState title="No open disputes" message="Disputes opened by customers or partners appear here." />
      ) : (
        <div className="grid gap-4">
          {disputes.map((d) => (
            <DisputeCard key={d.id} dispute={d} />
          ))}
        </div>
      )}
    </>
  );
}

function DisputeCard({ dispute }: { dispute: OrderDisputeDto }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'RESOLVED_CUSTOMER' | 'RESOLVED_PARTNER' | 'RESOLVED_SPLIT'>('RESOLVED_PARTNER');
  const [refund, setRefund] = useState('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const order = dispute.order;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['order-disputes'] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      void refresh();
    } catch (err) {
      setError(apiErrorMessage(err, 'Action failed'));
    }
  };

  return (
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">
          #{order?.orderNumber} · {order?.partner?.displayName} · {num(order?.totalAmount)} ֏
        </div>
        <div className="flex gap-2">
          <Badge tone={dispute.type === 'PAYMENT' ? 'pending' : 'danger'}>{dispute.type === 'PAYMENT' ? 'Payment dispute' : 'Order dispute'}</Badge>
          {Number(dispute.frozenAmount) > 0 ? <Badge tone="reserved">{num(dispute.frozenAmount)} ֏ frozen</Badge> : null}
          {dispute.openedAfterSettlement ? <Badge tone="neutral">after settlement</Badge> : null}
        </div>
      </div>
      <div className="mt-2 text-[14px]">
        Opened by {dispute.openedByType.toLowerCase()} on {new Date(dispute.createdAt).toLocaleString()} — <b>{dispute.reason}</b>
        {dispute.description ? `: ${dispute.description}` : ''}. Disputed: {num(dispute.disputedAmount)} ֏
      </div>
      <div className="mt-2 grid gap-1 text-[13px] text-muted">
        <div>
          Customer: {order?.customer ? `${order.customer.firstName ?? ''} ${order.customer.lastName ?? ''} ${order.customer.phone ?? ''}` : '—'}
        </div>
        {order?.paymentLegs.map((leg) => (
          <div key={leg.id}>
            {leg.type}: {num(leg.amount)} ֏ — {leg.status.toLowerCase()}
            {leg.confirmedAt ? ` (confirmed ${new Date(leg.confirmedAt).toLocaleString()})` : ''}
          </div>
        ))}
        <div>
          Stock confirmed: {order?.stockConfirmedAt ? new Date(order.stockConfirmedAt).toLocaleString() : '—'} · to courier:{' '}
          {order?.outForDeliveryAt ? new Date(order.outForDeliveryAt).toLocaleString() : '—'} · delivered (partner):{' '}
          {order?.deliveredAt ? new Date(order.deliveredAt).toLocaleString() : '—'} · customer confirmed receipt:{' '}
          {order?.customerReceivedAt ? new Date(order.customerReceivedAt).toLocaleString() : '—'}
        </div>
      </div>
      <div className="mt-3 grid gap-1">
        {(dispute.comments ?? []).map((c) => (
          <div key={c.id} className="text-[13px]">
            <span className="text-muted">{c.authorType.toLowerCase()}:</span> {c.body}
            {c.attachmentUrls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="ml-2 underline">
                evidence
              </a>
            ))}
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
          <Button size="sm" variant="secondary" disabled={!comment.trim()} onClick={() => act(() => partnerOrderAdminApi.commentDispute(dispute.id, comment.trim()).then(() => setComment('')))}>
            Comment
          </Button>
        </div>
      </div>
      {error ? <div className="mt-2 text-[13px] text-danger-text">{error}</div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="w-auto">
          <option value="RESOLVED_PARTNER">Partner is right</option>
          <option value="RESOLVED_CUSTOMER">Customer is right</option>
          <option value="RESOLVED_SPLIT">Split</option>
        </Select>
        {outcome !== 'RESOLVED_PARTNER' ? (
          <Input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Refund to customer (AMD)" className="w-48" />
        ) : null}
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (audit log)" />
        <Button
          disabled={note.trim().length < 3}
          onClick={() =>
            act(() =>
              partnerOrderAdminApi.resolveDispute(dispute.id, {
                outcome,
                customerRefundAmount: outcome === 'RESOLVED_PARTNER' ? undefined : refund || undefined,
                note: note.trim(),
              }),
            )
          }
        >
          Decide
        </Button>
      </div>
    </Surface>
  );
}
