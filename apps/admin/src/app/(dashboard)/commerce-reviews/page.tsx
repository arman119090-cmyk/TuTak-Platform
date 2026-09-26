'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerOrderCancellationDto } from '@tutak/shared-types';
import { Badge, Button, EmptyState, Input, PageHeader, Select, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { apiErrorMessage, partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

const num = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * The TuTak decisions the Partner Commerce final fixes introduced — each an
 * audited human decision, never a formula or a timer:
 *  - item 8: a partner's actual cancellation cost — approve, reduce or reject;
 *    at most the real money on the order, never a penalty;
 *  - Q9: a customer who refused a return's shortfall settlement — withdraw the
 *    return (nothing ever moved) or send it back to the desk;
 *  - Q8: open referral withholdings — read-only; they are repaid by the
 *    referrer's own future accruals and credited to the selling partner.
 */
export default function CommerceReviewsPage() {
  const cancellations = useQuery({ queryKey: ['cancellation-reviews'], queryFn: partnerOrderAdminApi.listCancellationReviews, refetchInterval: 20_000 });
  const returns = useQuery({ queryKey: ['return-reviews'], queryFn: partnerOrderAdminApi.listReturnReviews, refetchInterval: 20_000 });
  const withholdings = useQuery({ queryKey: ['withholdings'], queryFn: () => partnerOrderAdminApi.listWithholdings('OPEN') });

  return (
    <>
      <PageHeader
        title="Commerce reviews"
        description="Cancellation cost claims, disputed return shortfalls and open referral withholdings — decisions only TuTak makes."
      />

      <h2 className="mb-3 text-[16px] font-semibold">Cancellation cost claims</h2>
      {(cancellations.data ?? []).length === 0 ? (
        <EmptyState title="No cost claims" message="A partner's actual-cost claim on a customer cancellation appears here." />
      ) : (
        <div className="mb-8 grid gap-4">
          {(cancellations.data ?? []).map((c) => (
            <CancellationCard key={c.id} request={c} />
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-[16px] font-semibold">Disputed return shortfalls</h2>
      <ReturnReviews online={returns.data?.online ?? []} qr={returns.data?.qr ?? []} />

      <h2 className="mb-3 mt-8 text-[16px] font-semibold">Open referral withholdings</h2>
      {(withholdings.data ?? []).length === 0 ? (
        <EmptyState title="None open" message="A referrer who had already spent a share of a returned purchase appears here until repaid." />
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Referrer</Th>
              <Th>Level</Th>
              <Th align="right">Withheld</Th>
              <Th align="right">Still owed</Th>
              <Th>Commission refund to partner</Th>
              <Th>Since</Th>
            </Tr>
          </thead>
          <tbody>
            {(withholdings.data ?? []).map((w) => (
              <Tr key={w.id}>
                <Td>{w.userId.slice(0, 8)}</Td>
                <Td>L{w.level}</Td>
                <Td align="right">{num(w.amount)} ֏</Td>
                <Td align="right">{num(w.remainingAmount)} ֏</Td>
                <Td>{w.beneficiaryPartnerId.slice(0, 8)}</Td>
                <Td>{new Date(w.createdAt).toLocaleDateString()}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function CancellationCard({ request }: { request: PartnerOrderCancellationDto }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<'APPROVE' | 'REDUCE' | 'REJECT'>('REDUCE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const order = request.order;
  const cap = useQuery({ queryKey: ['cost-cap', request.orderId], queryFn: () => partnerOrderAdminApi.cancellationCostCap(request.orderId) });

  const decide = async () => {
    try {
      await partnerOrderAdminApi.decideCancellation(request.id, {
        decision,
        approvedAmount: decision === 'REDUCE' ? amount : undefined,
        note,
      });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['cancellation-reviews'] });
    } catch (err) {
      setError(apiErrorMessage(err, 'Decision failed'));
    }
  };

  return (
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">
          #{order?.orderNumber} · {order?.partner?.displayName} · {num(order?.totalAmount)} ֏
        </div>
        <Badge tone="pending">Claimed {num(request.claimedCostAmount)} ֏</Badge>
      </div>
      <div className="mt-2 grid gap-1 text-[13px]">
        <div>
          Customer’s reason: {request.reason ?? '—'} · asked {new Date(request.createdAt).toLocaleString()}
        </div>
        <div>
          Partner’s cost: <b>{request.costReason}</b>
          {request.costEvidence ? ` — evidence: ${request.costEvidence}` : ''}
          {request.costEvidenceUrls.length > 0 ? ` (${request.costEvidenceUrls.length} file(s))` : ''}
        </div>
        <div className="text-muted">Terms the customer saw before confirming: {order?.cancellationTerms ?? '—'}</div>
        <div className="text-muted">
          Real money on the order (the most that can be approved): {num(cap.data?.total)} ֏ — confirmed cash {num(cap.data?.external)} ֏, TuTak
          money {num(cap.data?.money)} ֏. The discount is always returned in full; anything above is never charged to the customer.
        </div>
      </div>
      {error ? <div className="mt-2 text-[13px] text-danger-text">{error}</div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={decision} onChange={(e) => setDecision(e.target.value as 'APPROVE' | 'REDUCE' | 'REJECT')} className="w-auto">
          <option value="APPROVE">Approve in full</option>
          <option value="REDUCE">Reduce to…</option>
          <option value="REJECT">Reject</option>
        </Select>
        {decision === 'REDUCE' ? <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Approved AMD" /> : null}
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (audit log)" />
        <Button disabled={note.trim().length < 3 || (decision === 'REDUCE' && !amount)} onClick={() => void decide()}>
          Decide and cancel the order
        </Button>
      </div>
    </Surface>
  );
}

function ReturnReviews({
  online,
  qr,
}: {
  online: Awaited<ReturnType<typeof partnerOrderAdminApi.listReturnReviews>>['online'];
  qr: Awaited<ReturnType<typeof partnerOrderAdminApi.listReturnReviews>>['qr'];
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['return-reviews'] });
    } catch (err) {
      setError(apiErrorMessage(err, 'Action failed'));
    }
  };
  const ask = (label: string) => window.prompt(`${label} — reason for the audit log`);
  const rows = [
    ...online.map((r) => ({
      id: r.id,
      kind: 'online' as const,
      label: `Order #${r.order.orderNumber}`,
      shortfall: r.shortfallAmount,
      gross: r.grossRefund,
      net: r.netRefund,
      note: r.refusalNote,
    })),
    ...qr.map((r) => ({
      id: r.id,
      kind: 'qr' as const,
      label: `QR purchase ${r.purchaseIntent.id.slice(0, 8)}`,
      shortfall: r.customerShortfall,
      gross: r.grossRefund,
      net: r.netRefund,
      note: r.refusalNote,
    })),
  ];
  if (rows.length === 0) {
    return <EmptyState title="Nothing disputed" message="A customer who refuses a return's shortfall settlement appears here. Nothing moves until you decide." />;
  }
  return (
    <>
      {error ? <div className="mb-2 text-[13px] text-danger-text">{error}</div> : null}
      <Table>
        <thead>
          <Tr>
            <Th>Return</Th>
            <Th align="right">Refund owed</Th>
            <Th align="right">Customer’s shortfall</Th>
            <Th align="right">Customer would get</Th>
            <Th>Customer said</Th>
            <Th align="right">Decision</Th>
          </Tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>{r.label}</Td>
              <Td align="right">{num(r.gross)} ֏</Td>
              <Td align="right">{num(r.shortfall)} ֏</Td>
              <Td align="right">{num(r.net)} ֏</Td>
              <Td>{r.note ?? '—'}</Td>
              <Td align="right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const note = ask('Back to the desk');
                      if (note)
                        void act(() =>
                          r.kind === 'online'
                            ? partnerOrderAdminApi.reviewReturn(r.id, { decision: 'REOPEN', note })
                            : partnerOrderAdminApi.reviewQrRefund(r.id, { decision: 'REOPEN', note }),
                        );
                    }}
                  >
                    Back to the desk
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      const note = ask('Withdraw the return');
                      if (note)
                        void act(() =>
                          r.kind === 'online'
                            ? partnerOrderAdminApi.reviewReturn(r.id, { decision: 'WITHDRAW', note })
                            : partnerOrderAdminApi.reviewQrRefund(r.id, { decision: 'WITHDRAW', note }),
                        );
                    }}
                  >
                    Withdraw return
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
