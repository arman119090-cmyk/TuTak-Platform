'use client';

import { useState } from 'react';
import { walletApi } from '@/lib/api/walletApi';

export default function BonusAdjustmentPage() {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      await walletApi.manualAdjust(userId, amount, direction, reason);
      setStatus('Adjustment applied and logged to the audit trail.');
      setAmount('');
      setReason('');
    } catch {
      setStatus('Failed to apply adjustment — check the user ID and available balance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Manual bonus adjustment</h1>
      <p className="mt-1 max-w-xl text-sm text-neutral-500">
        Credits or debits a user&apos;s wallet directly. Every adjustment is written to the bonus
        ledger and the system audit log with your identity attached.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-neutral-600">User ID</label>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600">Amount (points)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'CREDIT' | 'DEBIT')}
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
          >
            <option value="CREDIT">Credit (add points)</option>
            <option value="DEBIT">Debit (remove points)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-600">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-green py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Applying…' : 'Apply adjustment'}
        </button>
        {status ? <p className="text-sm text-neutral-600">{status}</p> : null}
      </form>
    </div>
  );
}
