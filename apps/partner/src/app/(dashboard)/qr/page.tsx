'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import type { PartnerBranchDto } from '@tutak/shared-types';
import { Button, PageHeader, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { buildPartnerPayQrPayload } from '@/lib/partnerPayQr';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * Pilot QR surface.
 *
 * Branches use the server-issued opaque `PartnerBranchQrCode` token. The QR
 * therefore carries no partnerId/branchId chosen by the browser: mobile scans
 * `TUTAK-BRANCH:<token>` and the API resolves the token back to the active
 * partner+branch before a PurchaseIntent can be opened. Revoking/rotating a
 * branch QR immediately invalidates printed copies without changing branch
 * ids or trusting client-constructed identifiers.
 *
 * The legacy `TUTAK-PAY:<partnerId>[:branchId]` payload remains only as the
 * whole-business fallback for partners that have no branch rows at all. Once
 * a partner has physical locations, every displayed/printable QR is the
 * opaque branch-token form.
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
          <p className="mt-4 max-w-md text-center text-[12px] text-faint">
            This is the legacy whole-business code because this partner has no active branch rows.
            Add a location to switch to revocable branch-specific QR tokens.
          </p>
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
            <BranchQrCard partnerId={partnerId} branch={branch} />
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
          ? 'One revocable code per location. Print each at its own till — a scan is resolved by TuTak to that exact active branch before a purchase can be opened.'
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

function BranchQrCard({ partnerId, branch }: { partnerId: string; branch: PartnerBranchDto }) {
  const queryClient = useQueryClient();
  const queryKey = ['branch-qr', partnerId, branch.id] as const;
  const { data: qr, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => partnerApi.getBranchQr(partnerId, branch.id),
  });

  const issue = useMutation({
    mutationFn: () => partnerApi.issueBranchQr(partnerId, branch.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (isLoading) {
    return <p className="py-8 text-[13px] text-faint">Loading QR…</p>;
  }

  if (isError) {
    return <p className="py-8 text-[13px] text-danger-text">Could not load this branch QR.</p>;
  }

  if (!qr) {
    return (
      <div className="py-8 text-center">
        <p className="mb-4 max-w-sm text-[13px] text-muted">
          This branch has no active QR yet. Issue one before printing anything for this till.
        </p>
        <Button loading={issue.isPending} onClick={() => issue.mutate()}>
          Issue branch QR
        </Button>
        {issue.isError ? (
          <p className="mt-3 text-[12px] text-danger-text">Could not issue the QR. Please try again.</p>
        ) : null}
      </div>
    );
  }

  return <QrCard payload={`TUTAK-BRANCH:${qr.token}`} />;
}

function QrCard({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="w-full max-w-md text-center">
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-available-surface px-3 py-1 text-[12px] font-medium text-available-text">
        <span className="h-1.5 w-1.5 rounded-full bg-available" />
        Active
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
