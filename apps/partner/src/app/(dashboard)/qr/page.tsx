'use client';

import { useState } from 'react';
import { Button, PageHeader, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { buildPartnerPayQrPayload } from '@/lib/partnerPayQr';

/**
 * NEXT_CLAUDE_TASK.md requirement 1: what a customer scans identifies the
 * partner only, never an amount — the customer enters the amount
 * themselves and a PurchaseIntent carries it from there, waiting for a
 * cashier's confirm/reject on the Purchase requests page. This code is
 * therefore static: same payload every time, no expiry, no per-purchase
 * invoice to generate. Comparing this to what the page used to do is
 * useful context — it used to collect an amount here and issue a
 * one-time `DYNAMIC_INVOICE` QR that a scan would redeem directly at the
 * old flat accrual rate; that path stayed alive for legacy compatibility
 * (`qrApi.issue`/`qrApi.redeem` still exist on the backend) but is no
 * longer how a normal purchase is meant to happen.
 */
export default function QrPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const [copied, setCopied] = useState(false);

  const payload = partnerId ? buildPartnerPayQrPayload(partnerId) : null;

  return (
    <>
      <PageHeader
        title="Payment QR"
        description="Your business's payment code. Customers scan it, enter the amount themselves, and it appears on Purchase requests for you to confirm."
      />

      <Surface className="flex min-h-[280px] flex-col items-center justify-center">
        {!payload ? (
          <div className="text-center text-[13px] text-muted">
            Your account isn't linked to a business yet.
          </div>
        ) : (
          <div className="w-full max-w-md text-center">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-available-surface px-3 py-1 text-[12px] font-medium text-available-text">
              <span className="h-1.5 w-1.5 rounded-full bg-available" />
              Always active — this code never expires
            </div>

            <div className="mx-auto mt-2 rounded-tutak-lg bg-canvas p-4 text-left">
              <div className="mb-1.5 text-[12px] font-medium text-muted">Payment code</div>
              <code
                data-testid="partner-pay-code"
                className="block break-all font-mono text-[13px] leading-relaxed text-ink"
              >
                {payload}
              </code>
            </div>

            <p className="mt-4 text-[12px] text-faint">
              Print it or display it at the till. It never carries an amount — the customer always
              enters that themselves.
            </p>

            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(payload);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy code'}
              </Button>
            </div>
          </div>
        )}
      </Surface>
    </>
  );
}
