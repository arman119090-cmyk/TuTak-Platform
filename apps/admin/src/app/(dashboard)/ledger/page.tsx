'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
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
 * A chart of accounts is only readable to whoever built it. PLATFORM_BANK in
 * particular reads as alarming without its sentence — it is negative, and
 * will stay negative until the acquirer settling PSP_RECEIVABLE into it is
 * modelled.
 */
const MEANING: Record<string, string> = {
  PSP_RECEIVABLE: 'owed to us by the acquirer',
  PARTNER_PAYABLE: 'owed by us to this partner',
  CUSTOMER_PAYABLE: 'owed by us to this customer',
  PLATFORM_REVENUE: 'commission kept, less points issued',
  BONUS_LIABILITY: 'points issued and not yet spent',
  BANK_CLEARING: 'payouts in flight right now',
  PLATFORM_BANK: 'paid out, less inflows recorded (acquirer settlement not modelled yet)',
};

export default function LedgerPage() {
  const [selected, setSelected] = useState<string | null>(null);

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
