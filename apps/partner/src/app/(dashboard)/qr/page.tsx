'use client';

import { useEffect, useState } from 'react';
import { QrCodeType } from '@tutak/shared-types';
import { Button, Field, Input, PageHeader, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { qrApi } from '@/lib/api/qrApi';

export default function QrPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const [amount, setAmount] = useState('');
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!issued) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.floor((+new Date(issued.expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [issued]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) return;
    setLoading(true);
    setCopied(false);
    try {
      const qr = await qrApi.issue({
        type: QrCodeType.DYNAMIC_INVOICE,
        partnerId,
        amount,
        expiresInSeconds: 900,
      });
      setIssued({ token: qr.token, expiresAt: qr.expiresAt });
    } finally {
      setLoading(false);
    }
  };

  const expired = issued !== null && secondsLeft === 0;

  return (
    <>
      <PageHeader
        title="Payment QR"
        description="Create a one-time invoice for a customer to scan in the TuTak app."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Surface>
          <form onSubmit={handleGenerate} className="space-y-4">
            <Field label="Amount" hint="Armenian dram.">
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="tabular text-[19px]"
              />
            </Field>
            <Button type="submit" size="lg" loading={loading} disabled={!partnerId} className="w-full">
              Generate QR
            </Button>
          </form>

          <p className="mt-4 text-[12px] text-faint">
            Codes expire after 15 minutes and can be redeemed only once.
          </p>
        </Surface>

        <Surface className="flex min-h-[320px] items-center justify-center">
          {!issued ? (
            <div className="text-center">
              <div className="text-[15px] font-semibold text-ink">No active invoice</div>
              <p className="mt-1.5 max-w-xs text-[13px] text-muted">
                Enter an amount and generate a code. It will appear here for the customer to scan.
              </p>
            </div>
          ) : (
            <div className="w-full text-center">
              <div
                className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${
                  expired
                    ? 'bg-canvas text-muted'
                    : secondsLeft < 60
                      ? 'bg-pending-surface text-pending-text'
                      : 'bg-available-surface text-available-text'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    expired ? 'bg-faint' : secondsLeft < 60 ? 'bg-pending' : 'bg-available'
                  }`}
                />
                {expired
                  ? 'Expired'
                  : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
              </div>

              <div className="tabular text-[34px] font-semibold tracking-[-0.02em] text-ink">
                {Number(amount || 0)
                  .toLocaleString('en-US')
                  .replace(/,/g, ' ')}{' '}
                ֏
              </div>

              <div className="mx-auto mt-6 max-w-md rounded-tutak-lg bg-canvas p-4 text-left">
                <div className="mb-1.5 text-[12px] font-medium text-muted">Invoice token</div>
                <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">
                  {issued.token}
                </code>
              </div>

              <div className="mt-4 flex justify-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard?.writeText(issued.token);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy token'}
                </Button>
                {expired ? (
                  <Button onClick={handleGenerate as unknown as () => void}>Generate new</Button>
                ) : null}
              </div>
            </div>
          )}
        </Surface>
      </div>
    </>
  );
}
