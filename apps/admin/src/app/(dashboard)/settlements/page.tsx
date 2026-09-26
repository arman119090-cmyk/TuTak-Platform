'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import {
  PartnerSettlementStatus,
  ReconciliationOutcome,
  type PartnerSettlementDto,
} from '@tutak/shared-types';
import { settlementAdminApi } from '@/lib/api/financeApi';
import { partnersApi } from '@/lib/api/partnersApi';
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
type Action =
  | 'ready'
  | 'approve'
  | 'payment-pending'
  | 'paid'
  | 'failed'
  | 'ambiguous'
  | 'cancel'
  | 'revoke-approval'
  | 'propose-moved'
  | 'propose-not-moved'
  | 'confirm';

const ACTIONS: Record<PartnerSettlementStatus, Action[]> = {
  [PartnerSettlementStatus.DRAFT]: ['ready', 'cancel'],
  [PartnerSettlementStatus.READY]: ['approve', 'cancel'],
  // Not 'cancel': the server refuses to cancel an approved settlement. While
  // it is provable no money moved, the approval can be revoked and the claims
  // released — for a dispute decided for the customer after approval. No
  // draft is made; the next closed-period draft picks the postings up.
  [PartnerSettlementStatus.APPROVED]: ['payment-pending', 'revoke-approval'],
  [PartnerSettlementStatus.PAYMENT_PENDING]: ['paid', 'failed', 'ambiguous'],
  // PAID is immutable and REQUIRES_RECONCILIATION is resolved by the
  // two-person reconciliation flow, not by a status button here.
  [PartnerSettlementStatus.PAID]: [],
  // The same for FAILED: the server refuses to cancel it, and revokes the
  // approval only when the attempt record proves no money moved.
  [PartnerSettlementStatus.FAILED]: ['payment-pending', 'revoke-approval'],
  /*
   * Not empty, and the empty version was a defect: the screen told people
   * this state was "resolved by two-person reconciliation" and then offered
   * no way to do it, so a settlement could enter a state the interface could
   * not leave. Proposing an outcome and confirming it are two entries
   * because they are two acts by two different people.
   */
  [PartnerSettlementStatus.REQUIRES_RECONCILIATION]: [
    'propose-moved',
    'propose-not-moved',
    'confirm',
  ],
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
  'revoke-approval': 'Revoke approval',
  'propose-moved': 'Propose: money did move',
  'propose-not-moved': 'Propose: money did not move',
  confirm: 'Confirm the proposal',
};

/** Actions that must say why. The server enforces 3-500 characters. */
const NEEDS_REASON: Action[] = [
  'failed',
  'ambiguous',
  'cancel',
  'revoke-approval',
  // A proposal about whether money moved is worthless without the evidence
  // it rests on — the server demands 3-1000 characters of it.
  'propose-moved',
  'propose-not-moved',
];

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

  /*
   * Drafting: the start of the cycle, and it was missing.
   *
   * Without it this screen could move settlements along and never create
   * one, so the only way a settlement could exist was an API call by hand.
   * A screen that manages a lifecycle it cannot begin is half a screen.
   */
  const [draftPartnerId, setDraftPartnerId] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftUntil, setDraftUntil] = useState('');

  const { data: partners = [] } = useQuery({
    queryKey: ['partners-for-settlement'],
    queryFn: () => partnersApi.list(),
  });

  /*
   * What has accrued for the chosen partner and nobody has claimed yet.
   *
   * Shown before drafting rather than after, because the figure is the whole
   * decision: drafting a settlement claims postings, and an admin who cannot
   * see what they are about to claim is pressing a button on trust.
   */
  const { data: position } = useQuery({
    queryKey: ['unsettled', draftPartnerId],
    queryFn: () => settlementAdminApi.unsettled(draftPartnerId),
    enabled: !!draftPartnerId,
  });

  const draft = useMutation({
    mutationFn: () => settlementAdminApi.draft(draftPartnerId, draftFrom, draftUntil),
    onSuccess: () => {
      setDraftPartnerId('');
      setDraftFrom('');
      setDraftUntil('');
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
    },
  });

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
        case 'revoke-approval':
          return settlementAdminApi.revokeApproval(row.id, value);
        case 'propose-moved':
          return settlementAdminApi.proposeReconciliation(
            row.id,
            ReconciliationOutcome.MONEY_MOVED,
            value,
          );
        case 'propose-not-moved':
          return settlementAdminApi.proposeReconciliation(
            row.id,
            ReconciliationOutcome.MONEY_DID_NOT_MOVE,
            value,
          );
        case 'confirm':
          return settlementAdminApi.confirmReconciliation(row.id);
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

  /**
   * Whoever proposed an outcome cannot confirm it.
   *
   * Same rule as approval and the same reason: "the money did move" is a
   * claim about the world, and one person asserting it twice is one person,
   * not two. Also hidden when there is no proposal yet — confirming nothing
   * is not an act.
   */
  const canConfirmReconciliation = (row: PartnerSettlementDto) =>
    !!row.reconciliationProposedAt &&
    (!row.reconciliationProposedByUserId ||
      !user ||
      row.reconciliationProposedByUserId !== user.id);

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

      <div className="space-y-3 rounded-lg border border-subtle p-4">
        <h2 className="text-[14px] font-medium">Draft a settlement</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-[12px]">
            Partner
            <select
              aria-label="Partner"
              className="rounded-md border border-subtle p-2 text-[13px]"
              value={draftPartnerId}
              onChange={(e) => setDraftPartnerId(e.target.value)}
            >
              <option value="">Choose…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            Period start
            <input
              aria-label="Period start"
              type="date"
              className="rounded-md border border-subtle p-2 text-[13px]"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            Period end
            <input
              aria-label="Period end"
              type="date"
              className="rounded-md border border-subtle p-2 text-[13px]"
              value={draftUntil}
              onChange={(e) => setDraftUntil(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button
              disabled={!draftPartnerId || !draftFrom || !draftUntil || draft.isPending}
              onClick={() => draft.mutate()}
            >
              Draft
            </Button>
          </div>
        </div>

        {position ? (
          <p className="text-[12px] text-faint">
            Unclaimed for this partner right now: {money(position.net)} net (
            {money(position.accrued)} earned less {money(position.deductions)} deducted).
            {position.unrecognised.length > 0
              ? ` Not classified, and therefore excluded: ${position.unrecognised.join(', ')}.`
              : ''}
          </p>
        ) : null}

        {draft.isError ? (
          <p className="text-[12px] text-danger">
            That period could not be drafted. It may overlap a settlement that already claims those
            postings.
          </p>
        ) : null}
      </div>

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
                      ) : action === 'confirm' && !canConfirmReconciliation(s) ? (
                        <span key={action} className="text-[12px] text-faint">
                          {s.reconciliationProposedAt
                            ? 'You proposed this — confirming is somebody else’s'
                            : 'Nothing proposed yet'}
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
                        {s.status === PartnerSettlementStatus.PAID ? 'Paid and immutable' : '—'}
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
              This is the only action that posts to the ledger, and it is irreversible — reversing a
              paid settlement is a refund, not an edit. The reference must be the bank&apos;s own.
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
