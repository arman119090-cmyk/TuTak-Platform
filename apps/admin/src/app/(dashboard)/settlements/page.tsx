'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { PartnerSettlementStatus, type PartnerSettlementDto } from '@tutak/shared-types';
import { settlementAdminApi } from '@/lib/api/financeApi';
import { useAuthStore } from '@/lib/stores/authStore';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const STATUS_TONE: Record<PartnerSettlementStatus, 'pending' | 'available' | 'danger' | 'neutral'> =
  {
    [PartnerSettlementStatus.DRAFT]: 'neutral',
    [PartnerSettlementStatus.READY]: 'pending',
    [PartnerSettlementStatus.APPROVED]: 'pending',
    [PartnerSettlementStatus.PAYMENT_PENDING]: 'pending',
    [PartnerSettlementStatus.PAID]: 'available',
    // Amber, not red: the entries stay claimed and the debt is unchanged.
    [PartnerSettlementStatus.FAILED]: 'pending',
    [PartnerSettlementStatus.REQUIRES_RECONCILIATION]: 'danger',
    [PartnerSettlementStatus.CANCELLED]: 'neutral',
  };

/**
 * The one action available at each status, and nothing else.
 *
 * Written as data rather than as a chain of conditionals in the markup so
 * that "what may be done to a settlement in this state" is a list somebody
 * can read against the service, instead of being spread across the render.
 */
type Action = 'ready' | 'approve' | 'payment-pending' | 'paid' | 'failed' | 'ambiguous' | 'cancel';

const ACTIONS: Record<PartnerSettlementStatus, Action[]> = {
  [PartnerSettlementStatus.DRAFT]: ['ready', 'cancel'],
  [PartnerSettlementStatus.READY]: ['approve', 'cancel'],
  [PartnerSettlementStatus.APPROVED]: ['payment-pending', 'cancel'],
  [PartnerSettlementStatus.PAYMENT_PENDING]: ['paid', 'failed', 'ambiguous'],
  // PAID is immutable and REQUIRES_RECONCILIATION is resolved by the
  // two-person reconciliation flow, not by a status button here.
  [PartnerSettlementStatus.PAID]: [],
  [PartnerSettlementStatus.FAILED]: ['payment-pending', 'cancel'],
  [PartnerSettlementStatus.REQUIRES_RECONCILIATION]: [],
  [PartnerSettlementStatus.CANCELLED]: [],
};

const ACTION_LABEL: Record<Action, string> = {
  ready: 'Mark ready',
  approve: 'Approve',
  'payment-pending': 'Transfer sent',
  paid: 'Transfer landed',
  failed: 'Transfer bounced',
  ambiguous: 'Bank answer unclear',
  cancel: 'Cancel',
};

/** Actions that must say why. The server enforces 3-500 characters. */
const NEEDS_REASON: Action[] = ['failed', 'ambiguous', 'cancel'];

/**
 * Partner settlements, from drafting one to recording that the bank paid it.
 *
 * ## The rule this screen exists to make visible
 *
 * Whoever drafts a settlement cannot approve it. That is enforced in the
 * service and would come back as a 409 either way — but an admin finding out
 * by being refused learns that the app is unpredictable, while an admin who
 * can see *why* the button is unavailable learns how the control works. So
 * Approve is disabled for the person named in `createdByUserId`, with the
 * reason written next to it.
 *
 * ## What has no button
 *
 * `PAID` is immutable: the ledger has been posted and reversing it is a
 * refund, never an edit. `REQUIRES_RECONCILIATION` is resolved by the
 * two-person reconciliation flow — proposing an outcome and a different
 * person confirming it — not by a status button, because "the money did
 * move" is a claim about the world that one admin should not be able to make
 * alone.
 *
 * `FAILED` deliberately keeps its actions. A bounced transfer does not
 * change what is owed, so another transfer may be made against the same
 * figure; making it terminal once stranded the claimed postings for ever.
 */
export default function AdminSettlementsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['admin-settlements'],
    queryFn: () => settlementAdminApi.list(),
  });

  const [pending, setPending] = useState<{ row: PartnerSettlementDto; action: Action } | null>(
    null,
  );
  const [text, setText] = useState('');

  const act = useMutation({
    mutationFn: async ({ row, action }: { row: PartnerSettlementDto; action: Action }) => {
      const value = text.trim();
      switch (action) {
        case 'ready':
          return settlementAdminApi.markReady(row.id, value || undefined);
        case 'approve':
          return settlementAdminApi.approve(row.id);
        case 'payment-pending':
          return settlementAdminApi.markPaymentPending(row.id);
        case 'paid':
          return settlementAdminApi.markPaid(row.id, value);
        case 'failed':
          return settlementAdminApi.markFailed(row.id, value);
        case 'ambiguous':
          return settlementAdminApi.markAmbiguous(row.id, value);
        case 'cancel':
          return settlementAdminApi.cancel(row.id, value);
      }
    },
    onSuccess: () => {
      setPending(null);
      setText('');
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
    },
  });

  /**
   * Whether this viewer may approve this settlement.
   *
   * Only ever narrows what the server would allow. If the maker is unknown
   * (an older row with no `createdByUserId`) the button stays available and
   * the server decides — a screen guessing "probably not allowed" would
   * block work the service would have permitted.
   */
  const canApprove = (row: PartnerSettlementDto) =>
    !row.createdByUserId || !user || row.createdByUserId !== user.id;

  const start = (row: PartnerSettlementDto, action: Action) => {
    if (NEEDS_REASON.includes(action) || action === 'paid' || action === 'ready') {
      setPending({ row, action });
      setText('');
      return;
    }
    act.mutate({ row, action });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner settlements"
        description="Drafting, approval by a second person, and what the bank did."
      />

      {isLoading ? null : settlements.length === 0 ? (
        <EmptyState
          title="No settlements"
          message="Nothing has been drafted for any partner yet."
        />
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Partner</Th>
              <Th>Period</Th>
              <Th>Net</Th>
              <Th>Status</Th>
              <Th>Prepared / approved</Th>
              <Th>Actions</Th>
            </Tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <Tr key={s.id}>
                <Td>{s.partnerId}</Td>
                <Td>
                  {day(s.periodStart)} — {day(s.periodEnd)}
                </Td>
                <Td>{money(s.netPayableAmount)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                </Td>
                <Td>
                  {s.createdByUserId ?? '—'} / {s.approvedByUserId ?? '—'}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {ACTIONS[s.status].map((action) =>
                      action === 'approve' && !canApprove(s) ? (
                        <span key={action} className="text-[12px] text-faint">
                          You prepared this — approval is somebody else&apos;s
                        </span>
                      ) : (
                        <Button
                          key={action}
                          variant={action === 'cancel' ? 'secondary' : 'primary'}
                          disabled={act.isPending}
                          onClick={() => start(s, action)}
                        >
                          {ACTION_LABEL[action]}
                        </Button>
                      ),
                    )}
                    {ACTIONS[s.status].length === 0 ? (
                      <span className="text-[12px] text-faint">
                        {s.status === PartnerSettlementStatus.PAID
                          ? 'Paid and immutable'
                          : s.status === PartnerSettlementStatus.REQUIRES_RECONCILIATION
                            ? 'Resolved by two-person reconciliation'
                            : '—'}
                      </span>
                    ) : null}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {pending ? (
        <div className="space-y-2 rounded-lg border border-subtle p-4">
          <label htmlFor="settlement-input" className="text-[13px] font-medium">
            {pending.action === 'paid'
              ? 'Bank transfer reference'
              : pending.action === 'ready'
                ? 'Document number (optional)'
                : 'Why?'}
          </label>
          <input
            id="settlement-input"
            className="w-full rounded-md border border-subtle p-2 text-[13px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {pending.action === 'paid' ? (
            <p className="text-[12px] text-faint">
              This is the only action that posts to the ledger, and it is
              irreversible — reversing a paid settlement is a refund, not an
              edit. The reference must be the bank&apos;s own.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={
                act.isPending ||
                (pending.action === 'paid' && text.trim().length < 1) ||
                (NEEDS_REASON.includes(pending.action) && text.trim().length < 3)
              }
              onClick={() => act.mutate(pending)}
            >
              {ACTION_LABEL[pending.action]}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Back
            </Button>
          </div>
          {act.isError ? (
            <p className="text-[12px] text-danger">
              That was refused. The settlement may have moved on since this page loaded.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
