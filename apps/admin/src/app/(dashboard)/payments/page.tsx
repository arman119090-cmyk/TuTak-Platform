'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { pspApi, treasuryApi, type UnresolvedPspAttempt } from '@/lib/api/financeApi';
import { LoadFailed } from '@/components/LoadFailed';

const num = (v: string | number | undefined) =>
  Number(v ?? 0)
    .toLocaleString('en-US', { maximumFractionDigits: 2 })
    .replace(/,/g, ' ');

const age = (iso: string) => {
  const hours = Math.floor((Date.now() - +new Date(iso)) / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

/**
 * Whether time alone has made this urgent.
 *
 * Age never resolves a payment — only the provider or two people reading its
 * record do that. What age changes is how loudly it should be shown, which is
 * the same rule the escalation sweep follows.
 */
const tone = (attempt: UnresolvedPspAttempt) =>
  attempt.escalationCount >= 4 ? 'danger' : attempt.escalationCount > 0 ? 'pending' : 'neutral';

/**
 * One row of the finance queue, and the two-person act that clears it.
 *
 * The proposal and the confirmation are separate requests by separate signed-in
 * people. This screen cannot short-circuit that — there is no field for the
 * second person's name, and the server refuses a confirmation from whoever
 * proposed — but it can make the state obvious, which is what stops somebody
 * asking a colleague to "just click it".
 */
function AttemptRow({ attempt }: { attempt: UnresolvedPspAttempt }) {
  const queryClient = useQueryClient();
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['psp-unresolved'] });
  const onError = (e: Error) => setError(e.message);

  const propose = useMutation({
    mutationFn: () => pspApi.proposeReconciliation(attempt.id, evidence),
    onSuccess: () => {
      setEvidence('');
      setError(null);
      refresh();
    },
    onError,
  });

  const confirm = useMutation({
    mutationFn: () => pspApi.confirmReconciliation(attempt.id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const proposed = attempt.reconciliationProposedAt !== null;

  return (
    <Tr>
      <Td className="font-mono text-[12px]">{attempt.providerBillId ?? '—'}</Td>
      <Td>
        <Badge tone={tone(attempt)}>{attempt.status}</Badge>
      </Td>
      <Td align="right" className="tabular font-semibold">
        {num(attempt.amount)} ֏
      </Td>
      <Td className="text-[12px] text-faint">{age(attempt.createdAt)}</Td>
      <Td className="font-mono text-[11px] text-faint">
        {attempt.purchaseIntent.id.slice(-8).toUpperCase()}
      </Td>
      <Td>
        {proposed ? (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] text-faint">
              Proposed: “{attempt.reconciliationEvidence}”
            </div>
            {/*
              The server refuses this when the signed-in user is the proposer,
              and so does a database constraint. Offered to everyone rather
              than hidden by a client-side identity check: the screen should
              not be the thing deciding who counts as a second person.
            */}
            <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Confirm: no money moved
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="What the provider's record shows"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              className="h-8 text-[13px]"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={evidence.trim().length < 3}
              loading={propose.isPending}
              onClick={() => propose.mutate()}
            >
              Propose: no money moved
            </Button>
          </div>
        )}
        {error && <div className="mt-1 text-[12px] text-danger-text">{error}</div>}
      </Td>
    </Tr>
  );
}

/**
 * Payments nobody can account for, and what the platform can actually pay.
 *
 * There is no control here for "this payment succeeded". Money arriving is
 * established by a verified provider callback and by nothing else — a person
 * asserting it would post to the ledger on somebody's word, which is the one
 * thing the payment module exists to prevent. The only human act available is
 * the opposite one, and it takes two of them.
 */
export default function PaymentsPage() {
  const {
    data: unresolved,
    isError: unresolvedFailed,
    refetch: refetchUnresolved,
  } = useQuery({
    queryKey: ['psp-unresolved'],
    queryFn: pspApi.unresolved,
    refetchInterval: 15_000,
  });
  const {
    data: dead,
    isError: deadFailed,
    refetch: refetchDead,
  } = useQuery({
    queryKey: ['psp-dead-lettered'],
    queryFn: pspApi.deadLettered,
    refetchInterval: 30_000,
  });
  const {
    data: position,
    isError: positionFailed,
    refetch: refetchPosition,
  } = useQuery({
    queryKey: ['treasury-position'],
    queryFn: treasuryApi.position,
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Payments"
        description="Provider payments that have not resolved, and what the platform can actually pay out today."
      />

      {/* A failed poll says nothing about the money: "Nothing unresolved" or a
          missing position over an error is the screen an operator trusts. */}
      {positionFailed && !position && (
        <div className="mb-6">
          <LoadFailed what="the treasury position" onRetry={() => refetchPosition()} />
        </div>
      )}
      {position && (
        <Surface className="mb-6 grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <Figure label="In the bank" value={`${num(position.platformBank)} ֏`} />
          {/*
            Named for what it means operationally rather than for the account
            it comes from: until the provider remits, this is money the
            platform cannot spend, and calling it a receivable invites
            somebody to treat it as cash.
          */}
          <Figure
            label="Held by the provider"
            value={`${num(position.unsettledAcquirerAmount)} ֏`}
            muted
          />
          <Figure label="Owed to partners" value={`${num(position.partnerPayable)} ֏`} muted />
          <Figure label="Safe to pay" value={`${num(position.safeToPay)} ֏`} strong />
          {position.paymentsWithUnknownFee > 0 && (
            <div className="col-span-2 text-[12px] text-faint md:col-span-4">
              {position.paymentsWithUnknownFee} captured payment
              {position.paymentsWithUnknownFee === 1 ? '' : 's'} with an unknown provider fee.
              Unknown, not zero — the provider does not report it, and booking it at zero would
              overstate what can be paid out.
            </div>
          )}
        </Surface>
      )}

      {unresolvedFailed ? (
        <LoadFailed what="unresolved payments" onRetry={() => refetchUnresolved()} />
      ) : unresolved === undefined ? (
        <p className="text-[13px] text-muted">Loading payments…</p>
      ) : unresolved.length > 0 ? (
        <Table>
          <thead>
            <Tr>
              <Th>Bill</Th>
              <Th>State</Th>
              <Th align="right">Amount</Th>
              <Th>Waiting</Th>
              <Th>Purchase</Th>
              <Th>Resolve</Th>
            </Tr>
          </thead>
          <tbody>
            {unresolved.map((attempt) => (
              <AttemptRow key={attempt.id} attempt={attempt} />
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="Nothing unresolved"
          message="Every provider payment has either completed or been answered."
        />
      )}

      {deadFailed && (
        <div className="mt-6">
          <LoadFailed what="failed provider callbacks" onRetry={() => refetchDead()} />
        </div>
      )}
      {dead && dead.length > 0 && (
        <Surface className="mt-6 p-4">
          <div className="mb-2 text-[13px] font-semibold text-danger-text">
            Callbacks that gave up ({dead.length})
          </div>
          <div className="mb-3 text-[12px] text-faint">
            Each one is a customer who may have paid for a purchase that never completed. They are
            kept, not discarded.
          </div>
          <Table>
            <thead>
              <Tr>
                <Th>Bill</Th>
                <Th>Received</Th>
                <Th align="right">Attempts</Th>
                <Th>Last error</Th>
              </Tr>
            </thead>
            <tbody>
              {dead.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-mono text-[12px]">{row.billId ?? '—'}</Td>
                  <Td className="text-[12px] text-faint">{age(row.receivedAt)} ago</Td>
                  <Td align="right" className="tabular">
                    {row.attempts}
                  </Td>
                  <Td className="max-w-[24rem] truncate text-[12px] text-faint">
                    {row.lastError ?? '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Surface>
      )}
    </>
  );
}

function Figure({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-[12px] text-faint">{label}</div>
      <div
        className={
          strong
            ? 'tabular text-[20px] font-semibold text-ink'
            : muted
              ? 'tabular text-[16px] text-faint'
              : 'tabular text-[16px] text-ink'
        }
      >
        {value}
      </div>
    </div>
  );
}
