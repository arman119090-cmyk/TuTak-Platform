'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { Role } from '@tutak/shared-types';
import { financeApi, type Payout } from '@/lib/api/financeApi';
import { useIdempotencyKey } from '@/lib/useIdempotencyKey';
import { partnersApi } from '@/lib/api/partnersApi';
import { useAuthStore } from '@/lib/stores/authStore';

const STATUS_TONE = {
  REQUESTED: 'pending',
  PAID: 'available',
  FAILED: 'danger',
} as const;

const COLLECTION_STATUS_TONE = {
  PENDING: 'pending',
  CONFIRMED: 'available',
} as const;

const fmt = (v: string | number) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });

export default function PayoutsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [partnerId, setPartnerId] = useState('');
  const [amount, setAmount] = useState('');
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionReference, setCollectionReference] = useState('');
  const [collectionTxnId, setCollectionTxnId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  /**
   * PAYOUT_MANAGE is granted to SUPER_ADMIN only, so an ADMIN would get a
   * 403 from every button below. Hiding them is a courtesy, not the control
   * — the server is the authority and enforces this regardless. Recording a
   * collection is gated on the same permission as everything else here,
   * because it is the same class of "money moved, someone attests to it"
   * action as recording an acquirer settlement. A recorded collection also
   * sits behind its own two-person rule now, same as a payout's confirm
   * step below — see `PartnerCollectionService.confirm`'s own docblock —
   * because a fabricated or duplicated collection still misstates what a
   * partner owes, even though it moves nothing external.
   */
  const canMoveMoney = user?.roles?.includes(Role.SUPER_ADMIN) ?? false;

  const { data: partners } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });
  const { data: balance } = useQuery({
    queryKey: ['partner-balance', partnerId],
    queryFn: () => financeApi.partnerBalance(partnerId),
    enabled: !!partnerId,
  });
  const { data: payouts } = useQuery({
    queryKey: ['partner-payouts', partnerId],
    queryFn: () => financeApi.partnerPayouts(partnerId),
    enabled: !!partnerId,
  });
  const { data: collections } = useQuery({
    queryKey: ['partner-collections', partnerId],
    queryFn: () => financeApi.partnerCollections(partnerId),
    enabled: !!partnerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-balance', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['partner-payouts', partnerId] });
  };

  const invalidateCollections = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-balance', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['partner-collections', partnerId] });
  };

  // A different partner or a different amount is a different intention and
  // gets its own key; the same pair retried after a timeout keeps it, which
  // is what lets the server recognise the retry instead of paying twice.
  const payoutKey = useIdempotencyKey([partnerId, amount]);
  // Same reasoning, plus the bank reference and transaction id: a different
  // one of either is a different transfer being recorded, not a retry of the
  // last one.
  const collectionKey = useIdempotencyKey([
    partnerId,
    collectionAmount,
    collectionReference,
    collectionTxnId,
  ]);

  const recordCollection = useMutation({
    mutationFn: () =>
      financeApi.recordCollection(
        partnerId,
        collectionAmount,
        collectionReference,
        collectionTxnId,
        collectionKey,
      ),
    onSuccess: () => {
      setCollectionAmount('');
      setCollectionReference('');
      setCollectionTxnId('');
      setCollectionError(null);
      invalidateCollections();
    },
    onError: (e: Error) => setCollectionError(e.message),
  });

  const [confirmCollectionError, setConfirmCollectionError] = useState<string | null>(null);
  const confirmCollection = useMutation({
    mutationFn: (collectionId: string) => financeApi.confirmCollection(collectionId),
    onSuccess: () => {
      setConfirmCollectionError(null);
      invalidateCollections();
    },
    onError: (e: Error) => setConfirmCollectionError(e.message),
  });

  // Available balance is negated PARTNER_PAYABLE — negative means the
  // partner, not TuTak, is in the red. That is the only state a collection
  // is meaningful in.
  const owedToUs = balance ? Math.max(0, -Number(balance.availableBalance)) : 0;

  const request = useMutation({
    mutationFn: () => financeApi.requestPayout(partnerId, amount, payoutKey),
    onSuccess: () => {
      setAmount('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      outcome,
      detail,
    }: {
      id: string;
      outcome: 'paid' | 'failed';
      detail: string;
    }) =>
      outcome === 'paid'
        ? financeApi.confirmPayout(id, detail)
        : financeApi.failPayout(id, detail),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  /**
   * Asks first, and treats "no" as no.
   *
   * The prompt used to live inside the mutation as
   * `window.prompt('Bank reference?') ?? 'unknown'`. Pressing Escape or
   * Cancel returns null, so a dismissed dialog confirmed the payout anyway
   * and recorded the bank reference as the literal string "unknown" — money
   * marked as sent, against a reference that can never be matched to a
   * statement, because somebody changed their mind half a second too late.
   *
   * Confirming a payout is the second half of the two-person rule. It is the
   * one action on this screen that must be deliberate, and a cancelled dialog
   * is the clearest statement of intent a person can make.
   */
  const askThenResolve = (id: string, outcome: 'paid' | 'failed') => {
    setError(null);
    const answer = window.prompt(
      outcome === 'paid'
        ? 'Bank reference for this transfer?'
        : 'Why did this payout fail?',
    );
    if (answer === null) return;

    const detail = answer.trim();
    if (!detail) {
      // Empty is not the same as cancelled — they pressed OK — so it gets an
      // answer rather than silence.
      setError(
        outcome === 'paid'
          ? 'A bank reference is required: it is what reconciles this payout against the statement.'
          : 'A reason is required, so the partner can be told why.',
      );
      return;
    }

    resolve.mutate({ id, outcome, detail });
  };

  const rows: Payout[] = payouts ?? [];
  const collectionRows = collections ?? [];

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Transfers of a partner's earned balance to their bank. Money sits in clearing between request and confirmation."
      />

      <Surface>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Partner">
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">Select a partner…</option>
                {(partners ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {partnerId && (
            <>
              <div className="w-44">
                <Field label="Amount (AMD)">
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="0.00"
                    disabled={!canMoveMoney}
                  />
                </Field>
              </div>
              <Button
                onClick={() => {
                  setError(null);
                  request.mutate();
                }}
                disabled={!canMoveMoney || !amount || request.isPending}
              >
                {request.isPending ? 'Requesting…' : 'Request payout'}
              </Button>
            </>
          )}
        </div>

        {partnerId && balance && (
          <p className="mt-3 text-[13px] text-muted">
            Available to pay out:{' '}
            <span className="tabular font-medium text-ink">
              {Number(balance.availableBalance).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}{' '}
              AMD
            </span>
          </p>
        )}
        {!canMoveMoney && (
          <p className="mt-2 text-[13px] text-muted">
            Requesting a payout requires SUPER_ADMIN. Wiring money to an external account is the
            least reversible action here, so it is deliberately not granted to ADMIN.
          </p>
        )}
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      </Surface>

      {partnerId && (
        <Surface className="mt-4">
          <h2 className="text-[14px] font-semibold text-ink">Record a collection</h2>
          <p className="mt-1 text-[13px] text-muted">
            The other direction: a partner&apos;s own bank transfer paying down commission they
            owe TuTak. Only usable up to what the balance actually shows against them. A
            different admin must confirm it below before it posts.
          </p>

          {owedToUs > 0 ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <p className="w-full text-[13px] text-muted">
                Owed to TuTak:{' '}
                <span className="tabular font-medium text-ink">{fmt(owedToUs)} AMD</span>
              </p>
              <div className="w-44">
                <Field label="Amount (AMD)">
                  <Input
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="0.00"
                    disabled={!canMoveMoney}
                  />
                </Field>
              </div>
              <div className="w-56">
                <Field label="Bank reference">
                  <Input
                    value={collectionReference}
                    onChange={(e) => setCollectionReference(e.target.value)}
                    placeholder="e.g. SWIFT-99120"
                    disabled={!canMoveMoney}
                  />
                </Field>
              </div>
              <div className="w-56">
                <Field label="Bank transaction ID">
                  <Input
                    value={collectionTxnId}
                    onChange={(e) => setCollectionTxnId(e.target.value)}
                    placeholder="the statement's own transaction id"
                    disabled={!canMoveMoney}
                  />
                </Field>
              </div>
              <Button
                onClick={() => {
                  setCollectionError(null);
                  recordCollection.mutate();
                }}
                disabled={
                  !canMoveMoney ||
                  !collectionAmount ||
                  !collectionReference.trim() ||
                  !collectionTxnId.trim() ||
                  recordCollection.isPending
                }
              >
                {recordCollection.isPending ? 'Recording…' : 'Record collection'}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted">
              This partner does not currently owe TuTak anything — there is nothing to collect.
            </p>
          )}
          {!canMoveMoney && owedToUs > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              Recording a collection requires SUPER_ADMIN, the same as every other route on this
              screen that touches a partner&apos;s balance.
            </p>
          )}
          {collectionError && <p className="mt-2 text-[13px] text-danger">{collectionError}</p>}
        </Surface>
      )}

      <div className="mt-6">
        {!partnerId ? (
          <EmptyState title="Select a partner" message="Pick a partner above to see their payouts." />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            message="Nothing has been transferred to this partner's bank."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Bank reference</Th>
                <Th>Requested by</Th>
                <Th>Requested</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td align="right" className="tabular font-medium text-ink">
                    {Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="tabular text-[12px] text-muted">
                    {p.bankReference ?? p.failureReason ?? '—'}
                  </Td>
                  <Td className="text-muted">
                    {p.requestedByName ?? '—'}
                    {p.confirmedByName && (
                      <span className="block text-[12px]">
                        confirmed by {p.confirmedByName}
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted">{new Date(p.createdAt).toLocaleString()}</Td>
                  <Td align="right">
                    {p.status === 'REQUESTED' && canMoveMoney && (
                      <div className="flex items-center justify-end gap-2">
                        {/* Own request: the API would refuse this, so the
                            button says why instead of producing a 403 the
                            admin has to interpret. */}
                        {p.requestedByUserId === user?.id && (
                          <span className="text-[12px] text-muted">
                            You requested this — someone else must confirm it
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={p.requestedByUserId === user?.id || resolve.isPending}
                          aria-label={`Confirm the ${Number(p.amount).toLocaleString('en-US')} payout requested by ${p.requestedByName ?? 'an unknown admin'}`}
                          onClick={() => askThenResolve(p.id, 'paid')}
                        >
                          {resolve.isPending &&
                          resolve.variables?.id === p.id &&
                          resolve.variables.outcome === 'paid'
                            ? 'Confirming…'
                            : 'Confirm'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={resolve.isPending}
                          onClick={() => askThenResolve(p.id, 'failed')}
                        >
                          {resolve.isPending &&
                          resolve.variables?.id === p.id &&
                          resolve.variables.outcome === 'failed'
                            ? 'Marking failed…'
                            : 'Mark failed'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {partnerId && (
        <div className="mt-6">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Collections</h2>
          {collectionRows.length === 0 ? (
            <EmptyState
              title="No collections yet"
              message="Nothing has been recorded as transferred in from this partner."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Bank reference</Th>
                  <Th>Recorded by</Th>
                  <Th>Recorded</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {collectionRows.map((c) => (
                  <Tr key={c.id}>
                    <Td align="right" className="tabular font-medium text-ink">
                      {fmt(c.amount)}
                    </Td>
                    <Td>
                      <Badge tone={COLLECTION_STATUS_TONE[c.status] ?? 'neutral'}>
                        {c.status.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td className="tabular text-[12px] text-muted">{c.bankReference}</Td>
                    <Td className="text-muted">
                      {c.recordedByName ?? '—'}
                      {c.confirmedByName && (
                        <span className="block text-[12px]">confirmed by {c.confirmedByName}</span>
                      )}
                    </Td>
                    <Td className="text-muted">{new Date(c.createdAt).toLocaleString()}</Td>
                    <Td align="right">
                      {c.status === 'PENDING' && canMoveMoney && (
                        <div className="flex items-center justify-end gap-2">
                          {/* Own record: the API would refuse this, so the
                              button says why instead of producing a 403 the
                              admin has to interpret. */}
                          {c.recordedByUserId === user?.id && (
                            <span className="text-[12px] text-muted">
                              You recorded this — someone else must confirm it
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={c.recordedByUserId === user?.id || confirmCollection.isPending}
                            aria-label={`Confirm the ${Number(c.amount).toLocaleString('en-US')} collection recorded by ${c.recordedByName ?? 'an unknown admin'}`}
                            onClick={() => {
                              setConfirmCollectionError(null);
                              confirmCollection.mutate(c.id);
                            }}
                          >
                            {confirmCollection.isPending && confirmCollection.variables === c.id
                              ? 'Confirming…'
                              : 'Confirm'}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {confirmCollectionError && (
            <p className="mt-2 text-[13px] text-danger">{confirmCollectionError}</p>
          )}
        </div>
      )}
    </>
  );
}
