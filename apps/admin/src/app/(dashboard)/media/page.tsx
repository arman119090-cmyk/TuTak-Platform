'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, PageHeader, Surface } from '@tutak/design/web';
import { mediaApi, type PendingMediaRow } from '@/lib/api/mediaApi';

/**
 * The brand-media approval queue — the platform half of
 * TUTAK_V2_MEDIA_SYSTEM_SPEC.md §1's two-party rule.
 *
 * A partner owner can submit a logo; only an administrator can publish it.
 * That rule only means something if there is somewhere to see what is
 * waiting — without this page, "an administrator must confirm it" quietly
 * becomes "nothing is ever published".
 *
 * Oldest first, matching the API's ordering: a business that has been waiting
 * three days should not be overtaken by one that submitted this morning.
 *
 * ## What an approver is actually deciding
 *
 * Whether this image may become the business's public identity, on the map
 * and on every future customer receipt. So the page shows the file large
 * enough to judge, names who uploaded it and when, and says plainly what
 * approving does. There is no "reject" action, deliberately: the API has none
 * either, because a submission that is simply wrong is superseded by the
 * partner's next upload, and an administrator declining to press approve is
 * already the refusal. A published asset that must come down is a different,
 * heavier action — revocation — and it lives on the partner's own record.
 */
export default function MediaQueuePage() {
  const { data, isLoading } = useQuery({ queryKey: ['media-pending'], queryFn: mediaApi.pending });

  return (
    <>
      <PageHeader
        title="Brand media review"
        description="Logos and covers partners have submitted. Nothing here is visible to customers until it is approved."
      />

      {isLoading ? (
        <Surface>
          <p className="text-[13px] text-muted">Loading…</p>
        </Surface>
      ) : !data || data.length === 0 ? (
        <Surface>
          <EmptyState
            title="Nothing waiting"
            message="When a partner submits a new logo or cover, it appears here for review."
          />
        </Surface>
      ) : (
        <div className="space-y-4">
          {data.map((row) => (
            <PendingCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function PendingCard({ row }: { row: PendingMediaRow }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const kindLabel = row.kind === 'PARTNER_LOGO' ? 'Logo' : 'Cover';

  const approve = useMutation({
    mutationFn: () => mediaApi.approve(row.partnerId!, row.id),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['media-pending'] });
    },
    onError: () => setError('Could not approve this submission. Please try again.'),
  });

  return (
    <Surface>
      <div className="flex flex-wrap items-start gap-6">
        <div
          className={`${
            row.kind === 'PARTNER_LOGO' ? 'h-32 w-32' : 'h-32 w-[228px]'
          } flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-sunken`}
        >
          {/* The signed preview URL, not the public one — this asset is
              deliberately not public yet, and the link is bound to this
              administrator and re-checked server-side on every request. */}
          {/* A plain <img>, not next/image: the source is a signed, expiring
              URL on the API's own origin, which Next's optimiser would need
              configured as a remote pattern and would then cache past the
              signature's lifetime. */}
          <img
            src={row.preview.url}
            alt={`${kindLabel} submitted by ${row.partnerDisplayName ?? 'a partner'}`}
            className="h-full w-full object-contain"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[17px] font-semibold text-ink">
              {row.partnerDisplayName ?? 'Unknown partner'}
            </div>
            <Badge tone="pending">{kindLabel}</Badge>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
            <Detail label="Submitted" value={new Date(row.createdAt).toLocaleString()} />
            <Detail label="By user" value={row.uploadedByUserId ?? '—'} />
            <Detail label="Format" value={row.mimeType.replace('image/', '').toUpperCase()} />
            <Detail label="Dimensions" value={`${row.width}×${row.height}`} />
            <Detail label="Size" value={`${Math.round(row.byteSize / 1024)} KB`} />
            <Detail label="Partner" value={row.partnerId ?? '—'} />
          </dl>

          <p className="mt-3 max-w-2xl text-[12px] text-faint">
            Approving publishes this as the partner's {kindLabel.toLowerCase()} everywhere a
            customer can see it. Their current one is kept on file, so purchases already made under
            it keep showing it.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}>
              Approve and publish
            </Button>
            {error ? <span className="text-[13px] text-danger-text">{error}</span> : null}
          </div>
        </div>
      </div>
    </Surface>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="tabular truncate text-ink">{value}</dd>
    </div>
  );
}
