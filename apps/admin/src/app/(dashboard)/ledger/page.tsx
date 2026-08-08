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
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { financeApi } from '@/lib/api/financeApi';

/**
 * `balance` is stored DEBIT-positive / CREDIT-negative, not normalized per
 * account type. Showing the raw sign to an operator would read as "the
 * platform owes minus nine thousand", so each account type is labelled with
 * what its sign actually means.
 */
const CREDIT_NORMAL = new Set([
  'PARTNER_PAYABLE',
  'CUSTOMER_PAYABLE',
  'PLATFORM_REVENUE',
  'BONUS_LIABILITY',
  'BANK_CLEARING',
]);

function displayBalance(type: string, balance: string): string {
  const value = Number(balance);
  const normalized = CREDIT_NORMAL.has(type) ? -value : value;
  return normalized.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * What a number in this account actually means.
 *
 * A chart of accounts is only readable to whoever built it, and these two
 * lines are the difference between an operator reading the screen and
 * guessing at it.
 */
const MEANING: Record<string, string> = {
  PSP_RECEIVABLE: 'owed to us by the acquirer',
  PARTNER_PAYABLE: 'owed by us to this partner',
  CUSTOMER_PAYABLE: 'owed by us to this customer',
  PLATFORM_REVENUE: 'commission kept, less points issued',
  BONUS_LIABILITY: 'points issued and not yet spent',
  BANK_CLEARING: 'payouts in flight right now',
  PLATFORM_BANK: 'cash the platform actually holds',
};

export default function LedgerPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [settledOn, setSettledOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: outstanding } = useQuery({
    queryKey: ['acquirer-outstanding'],
    queryFn: financeApi.outstandingReceivable,
  });
  const { data: settlements } = useQuery({
    queryKey: ['acquirer-settlements'],
    queryFn: financeApi.acquirerSettlements,
  });

  const recordSettlement = useMutation({
    mutationFn: () =>
      financeApi.recordAcquirerSettlement({
        amount,
        reference: reference.trim(),
        settledOn: new Date(settledOn).toISOString(),
      }),
    onSuccess: async () => {
      setAmount('');
      setReference('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['acquirer-outstanding'] });
      await queryClient.invalidateQueries({ queryKey: ['acquirer-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] });
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Could not record the settlement.',
      );
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ['ledger-accounts'],
    queryFn: financeApi.ledgerAccounts,
  });
  const { data: detail } = useQuery({
    queryKey: ['ledger-postings', selected],
    queryFn: () => financeApi.accountPostings(selected!),
    enabled: !!selected,
  });

  const rows = accounts ?? [];

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Double-entry accounts. Select one to see its postings and whether its stored balance still matches them."
      />

      {/* Money arriving from the acquirer.
          Entered by hand from the remittance advice on purpose: an inbound
          settlement asserts that money arrived, and that assertion should
          come from a person reading the bank's own statement rather than
          from an integration that could be compromised. */}
      <Surface className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Acquirer settlement</h2>
            <p className="mt-1 text-[13px] text-muted">
              Record the acquirer paying us, from their remittance advice. This is what turns a
              receivable into cash.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-muted">Still owed to us</div>
            <div className="tabular text-[19px] font-semibold text-ink">
              {outstanding
                ? Number(outstanding.outstandingReceivable).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })
                : '—'}{' '}
              AMD
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Amount">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                inputMode="decimal"
              />
            </Field>
          </div>
          <div className="w-64">
            <Field label="Statement reference">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="REMIT-2026-08-08"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Landed on">
              <Input type="date" value={settledOn} onChange={(e) => setSettledOn(e.target.value)} />
            </Field>
          </div>
          <Button
            onClick={() => {
              setError(null);
              recordSettlement.mutate();
            }}
            disabled={!amount || reference.trim().length === 0 || recordSettlement.isPending}
          >
            {recordSettlement.isPending ? 'Recording…' : 'Record'}
          </Button>
        </div>
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}

        {settlements && settlements.length > 0 && (
          <div className="mt-5">
            <Table>
              <thead>
                <tr>
                  <Th>Landed</Th>
                  <Th>Reference</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <Tr key={s.id}>
                    <Td className="tabular">{new Date(s.settledOn).toLocaleDateString()}</Td>
                    <Td className="font-mono text-[12px]">{s.reference}</Td>
                    <Td align="right" className="tabular">
                      {Number(s.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Surface>

      {rows.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          message="Ledger accounts are created on demand, the first time money moves through one."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Scope</Th>
              <Th align="right">Balance</Th>
              <Th>Currency</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => setSelected(a.id)}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {a.type.replace(/_/g, ' ').toLowerCase()}
                  </button>
                  {MEANING[a.type] && (
                    <p className="mt-0.5 text-[12px] text-muted">{MEANING[a.type]}</p>
                  )}
                </Td>
                <Td className="tabular text-[12px] text-muted">
                  {a.partnerId ?? a.userId ?? 'platform'}
                </Td>
                <Td align="right" className="tabular">
                  {displayBalance(a.type, a.balance)}
                </Td>
                <Td className="text-muted">{a.currency}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {detail && (
        <Surface className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">
                {detail.account.type.replace(/_/g, ' ').toLowerCase()}
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                Stored {detail.storedBalance} · replayed from postings {detail.replayedBalance}
              </p>
            </div>
            {/* The one thing worth alarming on: the cached balance and the
                postings behind it no longer agree, which is the ledger
                disagreeing with itself. */}
            <Badge tone={detail.inSync ? 'available' : 'danger'}>
              {detail.inSync ? 'in sync' : 'DRIFT'}
            </Badge>
          </div>

          <div className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>Kind</Th>
                  <Th>Source</Th>
                  <Th>Direction</Th>
                  <Th align="right">Amount</Th>
                  <Th>Posted</Th>
                </tr>
              </thead>
              <tbody>
                {detail.postings.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium text-ink">{p.transaction.kind}</Td>
                    <Td className="tabular text-[12px] text-muted">
                      {p.transaction.sourceType}:{p.transaction.sourceId.slice(0, 8)}
                    </Td>
                    <Td>
                      <Badge tone={p.direction === 'DEBIT' ? 'reserved' : 'pending'}>
                        {p.direction.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular">
                      {Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Td>
                    <Td className="text-muted">{new Date(p.createdAt).toLocaleString()}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Surface>
      )}
    </>
  );
}
