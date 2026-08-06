'use client';

import { useState } from 'react';
import { QrCodeType } from '@tutak/shared-types';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { qrApi } from '@/lib/api/qrApi';

export default function QrPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) return;
    setLoading(true);
    try {
      const qr = await qrApi.issue({
        type: QrCodeType.DYNAMIC_INVOICE,
        partnerId,
        amount,
        expiresInSeconds: 900,
      });
      setToken(qr.token);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Payment QR</h1>
      <p className="mt-1 max-w-xl text-sm text-neutral-500">
        Generate a one-time invoice QR code for a customer to scan and pay in the TuTak app. Codes
        expire after 15 minutes.
      </p>

      <form onSubmit={handleGenerate} className="mt-6 max-w-sm space-y-4 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-neutral-600">Amount (AMD)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !partnerId}
          className="w-full rounded-lg bg-brand-green py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate QR'}
        </button>
      </form>

      {token ? (
        <div className="mt-6 max-w-sm rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">Invoice token (encode as a QR for the customer):</p>
          <p className="mt-2 break-all rounded-lg bg-neutral-50 p-3 font-mono text-xs">{token}</p>
        </div>
      ) : null}
    </div>
  );
}
