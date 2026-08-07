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
import { partnersApi } from '@/lib/api/partnersApi';
import { useAuthStore } from '@/lib/stores/authStore';

const STATUS_TONE = {
  REQUESTED: 'pending',
  PAID: 'available',
  FAILED: 'danger',
} as const;

export default function PayoutsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [partnerId, setPartnerId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * PAYOUT_MANAGE is granted to SUPER_ADMIN only, so an ADMIN would get a
   * 403 from every button below. Hiding them is a courtesy, not the control
   * — the server is the authority and enforces this regardless.
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-balance', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['partner-payouts', partnerId] });
  };

  const request = useMutation({
    mutationFn: () => financeApi.requestPayout(partnerId, amount),
    onSuccess: () => {
      setAmount('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const resolve = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'paid' | 'failed' }) =>
      outcome === 'paid'
        ? financeApi.confirmPayout(id, window.prompt('Bank reference?') ?? 'unknown')
        : financeApi.failPayout(id, window.prompt('Failure reason?') ?? 'unspecified'),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const rows: Payout[] = payouts ?? [];

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
                  <Td className="text-muted">{new Date(p.createdAt).toLocaleString()}</Td>
                  <Td align="right">
                    {p.status === 'REQUESTED' && canMoveMoney && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => resolve.mutate({ id: p.id, outcome: 'paid' })}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => resolve.mutate({ id: p.id, outcome: 'failed' })}
                        >
                          Mark failed
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
    </>
  );
}
