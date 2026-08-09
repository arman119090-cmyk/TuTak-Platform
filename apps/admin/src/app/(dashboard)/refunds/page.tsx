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
import { financeApi, type PaymentRow } from '@/lib/api/financeApi';
import { partnersApi } from '@/lib/api/partnersApi';
import { useIdempotencyKey } from '@/lib/useIdempotencyKey';

export default function RefundsPage() {
  const queryClient = useQueryClient();
  const [partnerId, setPartnerId] = useState('');
  const [target, setTarget] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { data: partners } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });
  const { data: payments } = useQuery({
    queryKey: ['payments-search', partnerId],
    queryFn: () => financeApi.searchPayments({ partnerId: partnerId || undefined }),
  });

  // The payment and the amount are what the refund would *do*; the reason is
  // a note on it. Leaving the reason out means an operator who reworded it
  // after a timeout retries the same refund rather than authorising a second.
  const refundKey = useIdempotencyKey([target?.id ?? null, amount]);

  const refund = useMutation({
    mutationFn: () => financeApi.refund(target!.id, reason, refundKey, amount || undefined),
    onSuccess: (r) => {
      setDone(
        `Refunded ${r.amount}. Total refunded on this payment is now ${r.totalRefunded}` +
          (Number(r.bonusClawedBack) > 0 ? `, ${r.bonusClawedBack} points reclaimed.` : '.'),
      );
      setTarget(null);
      setAmount('');
      setReason('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['payments-search'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = payments ?? [];

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Return money to a customer. Points earned on the refunded portion are reclaimed automatically, as far as they are still unspent."
      />

      <Surface>
        <div className="w-64">
          <Field label="Filter by partner">
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">All partners</option>
              {(partners ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {done && <p className="mt-2 text-[13px] text-ink">{done}</p>}
      </Surface>

      {target && (
        <Surface className="mt-4">
          <h2 className="text-[15px] font-semibold text-ink">
            Refund {Number(target.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} AMD
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {target.user.firstName} {target.user.lastName} · {target.partner.displayName} · already
            refunded {target.refundedAmount}
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Field label="Amount (blank = full)">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={target.amount}
                />
              </Field>
            </div>
            <div className="w-80">
              <Field label="Reason">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Goods returned"
                />
              </Field>
            </div>
            <Button
              onClick={() => {
                setError(null);
                refund.mutate();
              }}
              disabled={reason.trim().length < 3 || refund.isPending}
            >
              {refund.isPending ? 'Refunding…' : 'Refund'}
            </Button>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </Surface>
      )}

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="No payments" message="No payments match this filter yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Partner</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Refunded</Th>
                <Th>Status</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const remaining = Number(p.amount) - Number(p.refundedAmount);
                return (
                  <Tr key={p.id}>
                    <Td className="font-medium text-ink">
                      {p.user.firstName} {p.user.lastName}
                    </Td>
                    <Td className="text-muted">{p.partner.displayName}</Td>
                    <Td align="right" className="tabular">
                      {Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Td>
                    <Td align="right" className="tabular text-muted">
                      {Number(p.refundedAmount).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })}
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'CAPTURED' ? 'available' : 'neutral'}>
                        {p.status.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {p.status === 'CAPTURED' && remaining > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          // Every row's button reads "Refund", so on a busy
                          // screen a dozen controls share one name. The label
                          // says which payment this one opens — for a screen
                          // reader, and for anyone else who has to tell them
                          // apart.
                          aria-label={`Refund ${p.user.firstName} ${p.user.lastName}'s ${p.amount} payment`}
                          onClick={() => setTarget(p)}
                        >
                          Refund
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
