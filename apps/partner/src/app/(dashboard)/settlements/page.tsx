'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { settlementApi } from '@/lib/api/financeApi';
import type { PartnerSettlementDto } from '@tutak/shared-types';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Tone per settlement status.
 *
 * `FAILED` is amber rather than red on purpose: a bounced transfer does not
 * change what is owed, the entries stay claimed, and another transfer may be
 * attempted against the same figure. Painting it as a loss would tell the
 * partner their money is gone when it is not.
 */
const STATUS_TONE: Record<string, 'pending' | 'available' | 'danger' | 'neutral'> = {
  DRAFT: 'neutral',
  READY: 'pending',
  APPROVED: 'pending',
  PAYMENT_PENDING: 'pending',
  PAID: 'available',
  FAILED: 'pending',
  REQUIRES_RECONCILIATION: 'danger',
  CANCELLED: 'neutral',
};

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Being prepared',
  READY: 'Awaiting approval',
  APPROVED: 'Approved for transfer',
  PAYMENT_PENDING: 'Transfer sent, not yet landed',
  PAID: 'Paid',
  FAILED: 'Transfer bounced — still owed',
  REQUIRES_RECONCILIATION: 'Unclear — being checked',
  CANCELLED: 'Cancelled',
};

/**
 * What TuTak owes this partner, and every statement of it.
 *
 * Read-only, and that is the design rather than a missing feature. A partner
 * is the payee; a payee who can adjust their own Net Position is not a payee.
 * Drafting, approving and marking a settlement paid all happen on the TuTak
 * side and all take two different people.
 *
 * The one control here is reporting a problem with a transfer. It deliberately
 * asserts nothing about whether money moved — it says "this does not look
 * right to me" and hands the question to finance, who need two people to
 * answer it. A button letting a partner declare a transfer missing would be a
 * button letting the payee decide a payment question about themselves.
 */
export default function SettlementsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const queryClient = useQueryClient();

  const { data: position } = useQuery({
    queryKey: ['partner-position', partnerId],
    queryFn: () => settlementApi.position(partnerId!),
    enabled: !!partnerId,
  });

  const { data: statements = [], isLoading } = useQuery({
    queryKey: ['partner-statements', partnerId],
    queryFn: () => settlementApi.statements(partnerId!),
    enabled: !!partnerId,
  });

  const [reporting, setReporting] = useState<PartnerSettlementDto | null>(null);
  const [reason, setReason] = useState('');

  const report = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      settlementApi.reportProblem(partnerId!, input.id, input.reason),
    onSuccess: () => {
      setReporting(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['partner-statements', partnerId] });
    },
  });

  if (!partnerId) {
    return <EmptyState title="No business" message="This account is not attached to a business." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="What TuTak owes you, and every transfer against it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {/*
          Accruing now, before anyone has drafted a settlement. Shown next to
          the statements rather than instead of them: a partner asking "where
          is my money" is usually asking about this figure, and a page that
          only listed finished settlements would answer a different question.
        */}
        <StatTile label="Accruing now" value={money(position?.net ?? '0')} />
        <StatTile label="Earned, not yet settled" value={money(position?.accrued ?? '0')} />
        <StatTile label="Deductions" value={money(position?.deductions ?? '0')} />
      </div>

      {/*
        Posting kinds nobody has classified. Surfaced rather than dropped:
        an unclassified posting on this partner's account is money whose side
        nobody has decided, and hiding it would make the three figures above
        quietly incomplete.
      */}
      {position?.unrecognised?.length ? (
        <p className="text-[13px] text-faint">
          Some activity is not yet classified and is excluded from the figures above:{' '}
          {position.unrecognised.join(', ')}. TuTak has been notified.
        </p>
      ) : null}

      {isLoading ? null : statements.length === 0 ? (
        <EmptyState
          title="No settlements yet"
          message="Nothing has been drafted. What you have earned so far is shown above."
        />
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Period</Th>
              <Th>Net</Th>
              <Th>Status</Th>
              <Th>Reference</Th>
              <Th>Paid</Th>
              <Th />
            </Tr>
          </thead>
          <tbody>
            {statements.map((s) => (
              <Tr key={s.id}>
                <Td>
                  {day(s.periodStart)} — {day(s.periodEnd)}
                </Td>
                <Td>{money(s.netPayableAmount)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>
                    {STATUS_TEXT[s.status] ?? s.status}
                  </Badge>
                </Td>
                <Td>{s.bankTransferReference ?? '—'}</Td>
                <Td>{s.paidAt ? day(s.paidAt) : '—'}</Td>
                <Td>
                  {/*
                    Only once a transfer has been claimed to have gone out.
                    There is nothing to dispute about a settlement still being
                    assembled, and offering the control anyway would invite a
                    complaint the server would only refuse.
                  */}
                  {s.status === 'PAYMENT_PENDING' || s.status === 'PAID' ? (
                    <Button variant="secondary" onClick={() => setReporting(s)}>
                      Report a problem
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {reporting ? (
        <Surfaceless>
          <label htmlFor="settlement-problem" className="text-[13px] font-medium">
            What is wrong with this transfer?
          </label>
          <textarea
            id="settlement-problem"
            className="w-full rounded-md border border-subtle p-2 text-[13px]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-[12px] text-faint">
            This tells TuTak to look. It does not record whether the money
            arrived — two people at TuTak decide that, and neither of them is
            you.
          </p>
          <div className="flex gap-2">
            <Button
              // Three characters is the server's own minimum; matching it here
              // means the partner is told before the request rather than by it.
              disabled={reason.trim().length < 3 || report.isPending}
              onClick={() => report.mutate({ id: reporting.id, reason: reason.trim() })}
            >
              Send
            </Button>
            <Button variant="secondary" onClick={() => setReporting(null)}>
              Cancel
            </Button>
          </div>
          {report.isError ? (
            <p className="text-[12px] text-danger">That could not be sent. Please try again.</p>
          ) : null}
        </Surfaceless>
      ) : null}
    </div>
  );
}

/** A plain panel — the design package's Surface is card chrome this does not want. */
function Surfaceless({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 rounded-lg border border-subtle p-4">{children}</div>;
}
