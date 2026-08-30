'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaAssetDto } from '@tutak/shared-types';
import { Badge, Button, PageHeader, Surface } from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerOwner, useAuthStore } from '@/lib/stores/authStore';
import { mediaApi, type BrandKind } from '@/lib/api/mediaApi';

/**
 * A partner's own brand media — TUTAK_V2_MEDIA_SYSTEM_SPEC.md §1 and §5.5.
 *
 * The page's whole job is to be honest about the two-party rule. An owner
 * uploads and the file is *submitted*, not published: it sits
 * `PENDING_REVIEW`, no customer sees it, and a platform administrator has to
 * confirm it before it becomes the business's public identity anywhere. That
 * exists because a logo appears on every customer's transaction history and
 * an owner account is one password away from a stranger — so the page says
 * "submitted for review", shows the pending file next to the live one, and
 * never implies the upload was the publication.
 *
 * OWNER-only, mirroring `assertPartnerOwner` on the API. A MANAGER or STAFF
 * operator gets an explanation rather than a 403 from a button that looked
 * like it would work.
 */
export default function BrandingPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const isOwner = isPartnerOwner(user, partnerId);

  const { data, isLoading } = useQuery({
    queryKey: ['partner-media', partnerId],
    queryFn: () => mediaApi.get(partnerId!),
    enabled: !!partnerId && isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <Header />
        <Surface>
          <p className="text-[13px] text-muted">
            Only the partner owner can change your business's logo and cover. Ask your owner
            account to manage this.
          </p>
        </Surface>
      </>
    );
  }

  const pendingFor = (kind: BrandKind) =>
    data?.pending.find((a) => a.kind === (kind === 'logo' ? 'PARTNER_LOGO' : 'PARTNER_COVER'));

  return (
    <>
      <Header />

      <Surface className="mb-4">
        <div className="text-[15px] font-semibold text-ink">How this works</div>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Upload a file and it is submitted for review. A TuTak administrator confirms it before it
          appears anywhere a customer can see — on the map, on your page, and on every receipt from
          your business. Until then your current logo stays live and nothing changes for your
          customers.
        </p>
        <p className="mt-2 max-w-2xl text-[13px] text-muted">
          JPEG, PNG or WebP, up to 5 MB. We re-encode every file on our side and strip location and
          camera data from it. A square logo works best; the cover is shown wide, at roughly 16:9.
        </p>
      </Surface>

      <div className="space-y-4">
        <BrandSlot
          kind="logo"
          title="Logo"
          description="Your business's mark. Shown on the map, on your partner page, and beside every purchase in a customer's history."
          live={data?.logo ?? null}
          pending={pendingFor('logo')}
          partnerId={partnerId ?? ''}
          loading={isLoading}
        />
        <BrandSlot
          kind="cover"
          title="Cover"
          description="Optional wide image for your partner page. Purely decorative — nothing depends on it."
          live={data?.cover ?? null}
          pending={pendingFor('cover')}
          partnerId={partnerId ?? ''}
          loading={isLoading}
        />
      </div>
    </>
  );
}

function Header() {
  return (
    <PageHeader
      title="Branding"
      description="Your logo and cover, as customers see them. Every change is reviewed by TuTak before it goes live."
    />
  );
}

function BrandSlot({
  kind,
  title,
  description,
  live,
  pending,
  partnerId,
  loading,
}: {
  kind: BrandKind;
  title: string;
  description: string;
  live: MediaAssetDto | null;
  pending: MediaAssetDto | undefined;
  partnerId: string;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = useMutation({
    mutationFn: (file: File) => mediaApi.submit(partnerId, kind, file),
    onSuccess: () => {
      setError(null);
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ['partner-media', partnerId] });
    },
    onError: (err: unknown) => {
      setSubmitted(false);
      // The API writes these for a person — "The image is 7.2 MB. The maximum
      // is 5 MB." tells an owner what to do, and a generic message does not.
      const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data
        ?.message;
      setError(
        typeof message === 'string'
          ? message
          : Array.isArray(message) && typeof message[0] === 'string'
            ? message[0]
            : 'Could not upload that file. Please try again.',
      );
    },
  });

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so picking the same file twice still fires a change.
    event.target.value = '';
    if (file) submit.mutate(file);
  };

  return (
    <Surface>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold text-ink">{title}</div>
          <p className="mt-1 max-w-xl text-[13px] text-muted">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          {pending ? <Badge tone="pending">Waiting for review</Badge> : null}
          {live ? <Badge tone="available">Live</Badge> : <Badge tone="neutral">Not set</Badge>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-6">
        <Preview label="Live now" asset={live} kind={kind} loading={loading} />
        {pending ? <Preview label="Submitted, awaiting review" asset={pending} kind={kind} /> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPick}
        />
        <Button
          size="sm"
          variant={live ? 'secondary' : 'primary'}
          loading={submit.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {live || pending ? `Submit a new ${kind}` : `Upload a ${kind}`}
        </Button>
        {submitted && !submit.isPending ? (
          <span className="text-[13px] text-muted">
            Submitted. It goes live once a TuTak administrator confirms it.
          </span>
        ) : null}
        {error ? <span className="text-[13px] text-danger-text">{error}</span> : null}
      </div>

      {live ? (
        <p className="mt-3 text-[12px] text-faint">
          Only TuTak can remove a live {kind}. Replacing it keeps the old one on file, so purchases
          made under your previous branding still show it — your customers' history stays
          recognisable.
        </p>
      ) : null}
    </Surface>
  );
}

/**
 * One preview tile.
 *
 * The image is fetched from the asset's signed `preview` URL rather than the
 * public one, because this page deliberately shows submissions nobody has
 * approved. That URL is bound to the person viewing and re-checked
 * server-side on every request, so a pending brand change cannot be leaked by
 * pasting the link somewhere.
 */
function Preview({
  label,
  asset,
  kind,
  loading,
}: {
  label: string;
  asset: MediaAssetDto | null | undefined;
  kind: BrandKind;
  loading?: boolean;
}) {
  const box = kind === 'logo' ? 'h-24 w-24' : 'h-24 w-[168px]';

  return (
    <div>
      <div className="mb-2 text-[12px] uppercase tracking-wide text-faint">{label}</div>
      <div
        className={`${box} flex items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-sunken`}
      >
        {loading ? (
          <span className="text-[12px] text-faint">…</span>
        ) : asset ? (
          // A plain <img>, not next/image: the source is a signed, expiring
          // URL on the API's own origin, which Next's optimiser would need
          // configured as a remote pattern and would then cache past the
          // signature's lifetime.
          <img
            src={asset.preview.url}
            alt={`${kind} preview`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="px-2 text-center text-[12px] text-faint">None</span>
        )}
      </div>
    </div>
  );
}

