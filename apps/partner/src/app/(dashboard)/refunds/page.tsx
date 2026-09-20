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
import { describeApiFailure, type ApiFailure } from '@/lib/apiError';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const num = (v: string | number | null | undefined) =>
  Number(v ?? 0)
    .toLocaleString('en-US', { maximumFractionDigits: 2 })
    .replace(/,/g, ' ');

const STATUS_TONE = {
  [RefundRequestStatus.PENDING]: 'pending',
  [RefundRequestStatus.APPROVED]: 'available',
  [RefundRequestStatus.REJECTED]: 'danger',
} as const;

/**
 * What a decision means to the person reading it. `APPROVED` is deliberately
 * not "refunded": approval is the owner's programmatic decision and the
 * engine's ledger move — whether cash was physically handed back at a till
 * is a separate fact this screen has no record of.
 */
const STATUS_TEXT: Record<RefundRequestStatus, string> = {
  [RefundRequestStatus.PENDING]: 'Waiting for a decision',
  [RefundRequestStatus.APPROVED]: 'Approved — refund recorded',
  [RefundRequestStatus.REJECTED]: 'Refused',
};

const shortId = (id: string) => id.slice(-8).toUpperCase();

/**
 * What the person is told when a decision or a request did not go through.
 *
 * After a lost answer the only honest thing to do is to read the request
 * again: a decision may have landed. So the lists are re-read first and the
 * person is told to look before pressing anything a second time. A second
 * approve on a request already approved is refused by the server anyway,
 * but the screen must not invite it.
 */
function ActionFailure({ failure }: { failure: ApiFailure }) {
  if (failure.kind === 'state') {
    return (
      <p role="alert" className="text-[12px] text-pending-text">
        This changed before your tap: {failure.message} The lists have been refreshed.
      </p>
    );
  }
  if (failure.kind === 'network') {
    return (
      <p role="alert" className="text-[12px] text-danger-text">
        The server could not be reached, so the outcome is unknown. The lists have been
        re-read — check the request&rsquo;s state before deciding again. Nothing you typed was
        lost.
      </p>
    );
  }
  return (
    <p role="alert" className="text-[12px] text-danger-text">
      {failure.message} Nothing you typed was lost.
    </p>
  );
}

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
 *
 * ## Two lists, two truths
 *
 * The requests and the completed sales come from different endpoints and
 * fail independently. Each has its own loading, error, stale and empty
 * state: "nothing waiting" is only ever said when the server said so, and a
 * completed sale that cannot be listed is a load error, not a sale that did
 * not happen.
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
  const [decisionFailure, setDecisionFailure] = useState<{ id: string; failure: ApiFailure } | null>(null);
  const [createFailure, setCreateFailure] = useState<ApiFailure | null>(null);

  const requestsQuery = useQuery({
    queryKey: ['refund-requests', partnerId],
    queryFn: () => refundRequestApi.list(partnerId!),
    enabled: !!partnerId,
    // An approver may be looking at this screen while a cashier is still
    // typing on theirs, at the same counter.
    refetchInterval: 10_000,
  });
  const requestsState = dataStateOf(requestsQuery);

  const purchasesQuery = useQuery({
    queryKey: ['confirmed-purchases', partnerId],
    queryFn: () => purchaseIntentApi.list(partnerId!, PurchaseIntentStatus.CONFIRMED),
    enabled: !!partnerId,
  });
  const purchasesState = dataStateOf(purchasesQuery);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['refund-requests', partnerId] });
    void queryClient.invalidateQueries({ queryKey: ['confirmed-purchases', partnerId] });
  };

  const create = useMutation({
    mutationFn: ({ purchaseIntentId }: { purchaseIntentId: string }) =>
      refundRequestApi.create(purchaseIntentId, {
        amount: amount.trim() ? amount.trim() : undefined,
        reason: reason.trim(),
      }),
    onMutate: () => setCreateFailure(null),
    onSuccess: () => {
      setRequestingFor(null);
      setAmount('');
      setReason('');
      invalidate();
    },
    // The form stays open with what was typed. If the request did land
    // (a lost answer), the refreshed list shows it waiting and the server
    // refuses a second one for the same sale — the button disappears.
    onError: (error) => {
      setCreateFailure(describeApiFailure(error));
      invalidate();
    },
  });

  /*
   * Decisions: re-read first, never act blind.
   *
   * A lost answer on approve or refuse is not "it did not happen". The
   * lists are refreshed before the person sees the message, so a request
   * that was in fact decided has already left the waiting list by the time
   * they read "check before deciding again".
   */
  const onDecisionError = (id: string) => (error: unknown) => {
    const described = describeApiFailure(error);
    setDecisionFailure({ id, failure: described });
    if (described.kind === 'state') {
      setRejectingId(null);
      setNote('');
    }
    invalidate();
  };

  const approve = useMutation({
    mutationFn: (id: string) => refundRequestApi.approve(id),
    onMutate: () => setDecisionFailure(null),
    onSuccess: invalidate,
    onError: (error, id) => onDecisionError(id)(error),
  });

  const reject = useMutation({
    mutationFn: (id: string) => refundRequestApi.reject(id, { note: note.trim() || undefined }),
    onMutate: () => setDecisionFailure(null),
    onSuccess: () => {
      setRejectingId(null);
      setNote('');
      invalidate();
    },
    onError: (error, id) => onDecisionError(id)(error),
  });

  const all = requestsQuery.data ?? [];
  const pending = all.filter((r) => r.status === RefundRequestStatus.PENDING);
  const decided = all.filter((r) => r.status !== RefundRequestStatus.PENDING);
  // A purchase with a request already waiting cannot take a second one —
  // the server refuses it, so the button is not offered either.
  const pendingByIntent = new Set(pending.map((r) => r.purchaseIntentId));

  /*
   * Finding the sale the customer is bringing back.
   *
   * The completed list is everything the server returns, which for a busy
   * business is long. Matched locally on the till code or the last
   * characters of the id — both things a receipt or the customer's phone
   * shows — so the cashier is not scrolling a month of sales by eye.
   */
  const [saleFilter, setSaleFilter] = useState('');
  const needle = saleFilter.trim().toUpperCase();
  const purchases = (purchasesQuery.data ?? []).filter(
    (purchase) =>
      !needle ||
      (purchase.confirmationCode ?? '').includes(needle) ||
      purchase.id.toUpperCase().includes(needle),
  );

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
      {requestsState === 'loading' ? (
        <LoadingNotice label="Loading refund requests…" />
      ) : requestsState === 'error' ? (
        <LoadError
          title="Refund requests could not be loaded"
          onRetry={() => void requestsQuery.refetch()}
          busy={requestsQuery.isFetching}
        />
      ) : (
        <>
          {requestsState === 'stale' ? (
            <StaleNotice
              asOf={requestsQuery.dataUpdatedAt}
              what="refund requests"
              onRetry={() => void requestsQuery.refetch()}
              busy={requestsQuery.isFetching}
            />
          ) : null}
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
                    onStartReject={() => {
                      setDecisionFailure(null);
                      setRejectingId(request.id);
                    }}
                    onCancelReject={() => {
                      setRejectingId(null);
                      setNote('');
                    }}
                    onApprove={() => approve.mutate(request.id)}
                    onReject={() => reject.mutate(request.id)}
                    busy={approve.isPending || reject.isPending}
                    failure={decisionFailure?.id === request.id ? decisionFailure.failure : null}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      <h2 className="mb-3 mt-10 text-[15px] font-semibold text-ink">Completed sales</h2>
      {purchasesState === 'loading' ? (
        <LoadingNotice label="Loading completed sales…" />
      ) : purchasesState === 'error' ? (
        <LoadError
          title="Completed sales could not be loaded"
          onRetry={() => void purchasesQuery.refetch()}
          busy={purchasesQuery.isFetching}
        />
      ) : (
        <>
          {purchasesState === 'stale' ? (
            <StaleNotice
              asOf={purchasesQuery.dataUpdatedAt}
              what="completed sales"
              onRetry={() => void purchasesQuery.refetch()}
              busy={purchasesQuery.isFetching}
            />
          ) : null}
          {(purchasesQuery.data ?? []).length > 0 ? (
            <div className="mb-4 max-w-[260px]">
              <Input
                placeholder="Till code or sale id"
                aria-label="Find a completed sale by till code or id"
                value={saleFilter}
                onChange={(event) => setSaleFilter(event.target.value)}
              />
            </div>
          ) : null}
          {purchases.length === 0 ? (
            <EmptyState
              title={needle ? 'No completed sale matches' : 'No completed sales yet'}
              message={
                needle
                  ? 'Check the code on the receipt or the customer’s phone. Older sales may not be in this list.'
                  : 'A sale appears here once it has been confirmed at the till.'
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Sale</Th>
                  <Th>Code</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Already returned</Th>
                  <Th align="right">Return</Th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <Tr key={purchase.id}>
                    <Td className="font-mono text-[12px] text-faint">{shortId(purchase.id)}</Td>
                    <Td className="font-mono text-[12px]">{purchase.confirmationCode ?? '—'}</Td>
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
                          onClick={() => {
                            setCreateFailure(null);
                            setRequestingFor(requestingFor === purchase.id ? null : purchase.id);
                          }}
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
        </>
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
            {createFailure ? <ActionFailure failure={createFailure} /> : null}
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
                    <Badge tone={STATUS_TONE[request.status]}>{STATUS_TEXT[request.status]}</Badge>
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
  failure,
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
  failure: ApiFailure | null;
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
          <div className="flex flex-col items-end gap-2">
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
            {failure ? <ActionFailure failure={failure} /> : null}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
              <Button loading={busy} onClick={onApprove}>
                Approve
              </Button>
              <Button variant="secondary" onClick={onStartReject}>
                Refuse
              </Button>
            </div>
            {failure ? <ActionFailure failure={failure} /> : null}
          </div>
        )}
      </Td>
    </Tr>
  );
}
