'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import type { PartnerBranchDto } from '@tutak/shared-types';
import { Button, PageHeader, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { buildPartnerPayQrPayload } from '@/lib/partnerPayQr';
import { partnerApi } from '@/lib/api/partnerApi';

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
 *
 * GitHub issue #28 (HIGH, 2026-08-16): this page used to print `payload` as
 * plain text only — nothing a camera could actually scan, despite the
 * copy telling merchants to "print it or display it at the till". Fixed by
 * rendering the same, unmodified payload as a real QR symbol
 * (`QRCodeSVG`), so what a customer's phone scans is exactly what
 * `parsePartnerPayQr` on the mobile side expects. The text payload stays
 * as a manual fallback (typed in, or copy/pasted) for when a scan isn't
 * possible. The plate is hardcoded white with near-black modules, not
 * theme-driven — a QR symbol is dark-on-light by spec, and plenty of
 * cheap merchant handhelds refuse an inverted one.
 *
 * 2026-08-26 (Arman): a chain with several locations needs one code *per
 * location* — same partner, but a scan should be traceable to which shop it
 * happened at, and it should be visually obvious at a glance that these are
 * several codes for one business rather than unrelated ones. So: no active
 * branches (the common case for a single-location partner, unchanged since
 * this page shipped) still shows exactly the one whole-business code below;
 * one or more active branches replaces it with one card per branch, each
 * encoding `partnerId:branchId` — see `buildPartnerPayQrPayload`.
 */
const QR_DARK = '#0A0D14';
const QR_LIGHT = '#FFFFFF';

export default function QrPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data: branches } = useQuery({
    queryKey: ['partner-branches', partnerId],
    queryFn: () => partnerApi.listBranches(partnerId!),
    enabled: !!partnerId,
  });
  const activeBranches = (branches ?? []).filter((b) => b.isActive);

  if (!partnerId) {
    return (
      <>
        <Header multiLocation={false} />
        <Surface className="flex min-h-[280px] flex-col items-center justify-center">
          <div className="text-center text-[13px] text-muted">
            Your account isn't linked to a business yet.
          </div>
        </Surface>
      </>
    );
  }

  if (activeBranches.length === 0) {
    return (
      <>
        <Header multiLocation={false} />
        <Surface className="flex min-h-[280px] flex-col items-center justify-center">
          <QrCard payload={buildPartnerPayQrPayload(partnerId)} />
        </Surface>
      </>
    );
  }

  return (
    <>
      <Header multiLocation />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {activeBranches.map((branch) => (
          <Surface key={branch.id} className="flex flex-col items-center">
            <BranchLabel branch={branch} />
            <QrCard payload={buildPartnerPayQrPayload(partnerId, branch.id)} />
          </Surface>
        ))}
      </div>
    </>
  );
}

function Header({ multiLocation }: { multiLocation: boolean }) {
  return (
    <PageHeader
      title="Payment QR"
      description={
        multiLocation
          ? 'One code per location, all belonging to the same business. Print each at its own till — a scan tells you which location a purchase happened at.'
          : "Your business's payment code. Customers scan it, enter the amount themselves, and it appears on Purchase requests for you to confirm."
      }
    />
  );
}

function BranchLabel({ branch }: { branch: PartnerBranchDto }) {
  return (
    <div className="mb-3 w-full text-left">
      <div className="text-[14px] font-semibold text-ink">{branch.name}</div>
      <div className="text-[12px] text-muted">
        {branch.address}, {branch.city}
      </div>
    </div>
  );
}

function QrCard({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="w-full max-w-md text-center">
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-available-surface px-3 py-1 text-[12px] font-medium text-available-text">
        <span className="h-1.5 w-1.5 rounded-full bg-available" />
        Always active — this code never expires
      </div>

      <div
        data-testid="partner-pay-qr-image"
        className="mx-auto flex w-fit items-center justify-center rounded-tutak-lg p-4"
        style={{ backgroundColor: QR_LIGHT }}
      >
        <QRCodeSVG
          value={payload}
          size={200}
          level="M"
          marginSize={2}
          bgColor={QR_LIGHT}
          fgColor={QR_DARK}
          title="Payment QR code"
        />
      </div>

      <div className="mx-auto mt-4 rounded-tutak-lg bg-canvas p-4 text-left">
        <div className="mb-1.5 text-[12px] font-medium text-muted">Payment code</div>
        <code
          data-testid="partner-pay-code"
          className="block break-all font-mono text-[13px] leading-relaxed text-ink"
        >
          {payload}
        </code>
      </div>

      <p className="mt-4 text-[12px] text-faint">
        Print it or display it at the till. It never carries an amount — the customer always enters
        that themselves.
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
  );
}
