'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PurchaseIntentStatus,
  RefundRequestStatus,
  type PurchaseIntentRefundRequestDto,
} from '@tutak/shared-types';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerApprover, useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { refundRequestApi } from '@/lib/api/refundRequestApi';

const num = (v: string | number | null | undefined) =>
  Number(v ?? 0)
    .toLocaleString('en-US', { maximumFractionDigits: 2 })
    .replace(/,/g, ' ');

const STATUS_TONE = {
  [RefundRequestStatus.PENDING]: 'pending',
  [RefundRequestStatus.APPROVED]: 'available',
  [RefundRequestStatus.REJECTED]: 'danger',
} as const;

const shortId = (id: string) => id.slice(-8).toUpperCase();

/**
 * Returns, both halves of them.
 *
 * A refund here is never one person's tap: staff ask, an owner or manager
 * decides (`PurchaseIntentRefundRequestService`). So this screen is written
 * for two different people looking at it —
 *
 *   - the cashier, who needs to find the sale the customer is bringing back
 *     and say what is wrong with it, and then see what came of it;
 *   - the owner or manager, who needs enough on one line to decide: how
 *     much, why, who asked, and against which sale.
 *
 * Which half is actionable is decided by `isPartnerApprover`, and only to
 * choose what to draw — the server refuses either way, so this is about not
 * showing a cashier a button that can only answer 403.
 */
export default function RefundsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const canDecide = isPartnerApprover(user, partnerId);
  const queryClient = useQueryClient();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [requestingFor, setRequestingFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const { data: requests } = useQuery({
    queryKey: ['refund-requests', partnerId],
    queryFn: () => refundRequestApi.list(partnerId!),
    enabled: !!partnerId,
    // An approver may be looking at this screen while a cashier is still
    // typing on theirs, at the same counter.
    refetchInterval: 10_000,
  });

  const { data: confirmed } = useQuery({
    queryKey: ['confirmed-purchases', partnerId],
    queryFn: () => purchaseIntentApi.list(partnerId!, PurchaseIntentStatus.CONFIRMED),
    enabled: !!partnerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['refund-requests', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['confirmed-purchases', partnerId] });
  };

  const create = useMutation({
    mutationFn: ({ purchaseIntentId }: { purchaseIntentId: string }) =>
      refundRequestApi.create(purchaseIntentId, {
        amount: amount.trim() ? amount.trim() : undefined,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setRequestingFor(null);
      setAmount('');
      setReason('');
      invalidate();
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => refundRequestApi.approve(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (id: string) => refundRequestApi.reject(id, { note: note.trim() || undefined }),
    onSuccess: () => {
      setRejectingId(null);
      setNote('');
      invalidate();
    },
  });

  const all = requests ?? [];
  const pending = all.filter((r) => r.status === RefundRequestStatus.PENDING);
  const decided = all.filter((r) => r.status !== RefundRequestStatus.PENDING);
  const purchases = confirmed ?? [];
  // A purchase with a request already waiting cannot take a second one —
  // the server refuses it, so the button is not offered either.
  const pendingByIntent = new Set(pending.map((r) => r.purchaseIntentId));

  return (
    <>
      <PageHeader
        title="Returns"
        description={
          canDecide
            ? 'Refunds your staff have asked for. Nothing has moved until you approve it.'
            : 'Ask for a refund on a completed sale. An owner or manager decides.'
        }
      />

      <h2 className="mb-3 text-[15px] font-semibold text-ink">
        {canDecide ? 'Waiting for your decision' : 'Waiting for a decision'}
      </h2>
      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          message="A refund your staff ask for appears here until somebody decides it."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Sale</Th>
              <Th align="right">Amount</Th>
              <Th>Reason</Th>
              <Th>Asked</Th>
              <Th align="right">Decision</Th>
            </tr>
          </thead>
          <tbody>
            {pending.map((request) => (
              <PendingRow
                key={request.id}
                request={request}
                canDecide={canDecide}
                rejecting={rejectingId === request.id}
                note={note}
                setNote={setNote}
                onStartReject={() => setRejectingId(request.id)}
                onCancelReject={() => {
                  setRejectingId(null);
                  setNote('');
                }}
                onApprove={() => approve.mutate(request.id)}
                onReject={() => reject.mutate(request.id)}
                busy={approve.isPending || reject.isPending}
              />
            ))}
          </tbody>
        </Table>
      )}

      <h2 className="mb-3 mt-10 text-[15px] font-semibold text-ink">Completed sales</h2>
      {purchases.length === 0 ? (
        <EmptyState
          title="No completed sales yet"
          message="A sale appears here once it has been confirmed at the till."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Sale</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Already returned</Th>
              <Th align="right">Return</Th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => (
              <Tr key={purchase.id}>
                <Td className="font-mono text-[12px] text-faint">{shortId(purchase.id)}</Td>
                <Td align="right" className="tabular">
                  {num(purchase.grossAmount)} ֏
                </Td>
                <Td align="right" className="tabular text-muted">
                  {num(purchase.refundedAmount ?? '0')} ֏
                </Td>
                <Td align="right">
                  {pendingByIntent.has(purchase.id) ? (
                    <span className="text-[12px] text-muted">Waiting for a decision</span>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setRequestingFor(requestingFor === purchase.id ? null : purchase.id)
                      }
                    >
                      {requestingFor === purchase.id ? 'Cancel' : 'Ask for a refund'}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {requestingFor ? (
        <Surface className="mt-4 max-w-[520px] p-4">
          <p className="mb-3 text-[13px] text-muted">
            Sale <span className="font-mono">{shortId(requestingFor)}</span>. Leave the amount empty
            to return everything that is left.
          </p>
          <div className="flex flex-col gap-3">
            <Input
              inputMode="decimal"
              placeholder="Amount, e.g. 1500"
              aria-label="Amount to return"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Input
              placeholder="Why is it coming back?"
              aria-label="Reason for the refund"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div>
              <Button
                loading={create.isPending}
                disabled={reason.trim().length < 3}
                onClick={() => create.mutate({ purchaseIntentId: requestingFor })}
              >
                Send for a decision
              </Button>
            </div>
            {create.isError ? (
              <p className="text-[12px] text-danger-text">
                Could not send this request. Check the amount is not more than the sale.
              </p>
            ) : null}
          </div>
        </Surface>
      ) : null}

      {decided.length > 0 ? (
        <>
          <h2 className="mb-3 mt-10 text-[15px] font-semibold text-ink">Already decided</h2>
          <Table>
            <thead>
              <tr>
                <Th>Sale</Th>
                <Th align="right">Amount</Th>
                <Th>Reason</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {decided.map((request) => (
                <Tr key={request.id}>
                  <Td className="font-mono text-[12px] text-faint">
                    {shortId(request.purchaseIntentId)}
                  </Td>
                  <Td align="right" className="tabular">
                    {request.amount ? `${num(request.amount)} ֏` : 'Everything left'}
                  </Td>
                  <Td className="text-muted">{request.reason}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
                    {request.decisionNote ? (
                      <span className="ml-2 text-[12px] text-muted">{request.decisionNote}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </>
  );
}

function PendingRow({
  request,
  canDecide,
  rejecting,
  note,
  setNote,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
  busy,
}: {
  request: PurchaseIntentRefundRequestDto;
  canDecide: boolean;
  rejecting: boolean;
  note: string;
  setNote: (v: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  return (
    <Tr>
      <Td className="font-mono text-[12px] text-faint">{shortId(request.purchaseIntentId)}</Td>
      <Td align="right" className="tabular font-medium">
        {request.amount ? `${num(request.amount)} ֏` : 'Everything left'}
      </Td>
      <Td className="text-muted">{request.reason}</Td>
      <Td className="text-[12px] text-muted">
        {new Date(request.requestedAt).toLocaleString('en-GB')}
      </Td>
      <Td align="right">
        {!canDecide ? (
          <span className="text-[12px] text-muted">Waiting for an owner or manager</span>
        ) : rejecting ? (
          <div className="flex items-center justify-end gap-2">
            <Input
              placeholder="Why not?"
              aria-label="Why this refund is refused"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button variant="destructive" loading={busy} onClick={onReject}>
              Refuse
            </Button>
            <Button variant="secondary" onClick={onCancelReject}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button loading={busy} onClick={onApprove}>
              Approve
            </Button>
            <Button variant="secondary" onClick={onStartReject}>
              Refuse
            </Button>
          </div>
        )}
      </Td>
    </Tr>
  );
}
