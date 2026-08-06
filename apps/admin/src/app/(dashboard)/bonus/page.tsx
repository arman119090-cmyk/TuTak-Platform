'use client';

import { useState } from 'react';
import { Button, Field, Input, PageHeader, Select, Surface, Textarea } from '@tutak/design/web';
import { walletApi } from '@/lib/api/walletApi';

export default function BonusAdjustmentPage() {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      await walletApi.manualAdjust(userId, amount, direction, reason);
      setStatus({ ok: true, message: 'Adjustment applied and written to the audit trail.' });
      setAmount('');
      setReason('');
    } catch {
      setStatus({
        ok: false,
        message: 'Adjustment failed. Check the user ID and, for a debit, the available balance.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isCredit = direction === 'CREDIT';

  return (
    <>
      <PageHeader
        title="Manual bonus adjustment"
        description="Credit or debit a wallet directly. Every adjustment is permanently recorded."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Surface>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="User ID" hint="The customer's UUID.">
              <Input required value={userId} onChange={(e) => setUserId(e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount" hint="Bonus points.">
                <Input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Direction">
                <Select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'CREDIT' | 'DEBIT')}
                >
                  <option value="CREDIT">Credit — add points</option>
                  <option value="DEBIT">Debit — remove points</option>
                </Select>
              </Field>
            </div>

            <Field label="Reason" hint="Shown in the audit log. Be specific.">
              <Textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Goodwill credit for support ticket #1423"
              />
            </Field>

            <div className="flex items-center gap-3">
              <Button type="submit" loading={submitting}>
                Apply adjustment
              </Button>
              {status ? (
                <span
                  className={`text-[13px] ${status.ok ? 'text-available-text' : 'text-danger-text'}`}
                >
                  {status.message}
                </span>
              ) : null}
            </div>
          </form>
        </Surface>

        {/* Consequence panel: states plainly what the action will do, so a
            debit is never applied casually. */}
        <Surface>
          <div className="text-[15px] font-semibold text-ink">What this does</div>
          <div className="mt-4 space-y-3 text-[13px] text-muted">
            <p>
              {isCredit
                ? 'A credit creates a new bonus lot that is immediately available to spend and expires on the standard schedule.'
                : 'A debit consumes the oldest-expiring available lots first. It cannot exceed the available balance, and it never touches pending or reserved points.'}
            </p>
            <p>
              The movement is written to the wallet ledger and to the system audit log with your
              identity attached. It cannot be edited or deleted afterwards.
            </p>
          </div>
          <div
            className={`mt-5 rounded-tutak-md px-3.5 py-3 text-[13px] ${
              isCredit
                ? 'bg-available-surface text-available-text'
                : 'bg-pending-surface text-pending-text'
            }`}
          >
            {isCredit ? 'Adds points to the wallet.' : 'Removes points from the wallet.'}
          </div>
        </Surface>
      </div>
    </>
  );
}
