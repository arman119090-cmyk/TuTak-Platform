'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PartnerIntegrationStatus,
  PartnerIntegrationType,
  type PartnerIntegrationDto,
} from '@tutak/shared-types';
import type { BadgeTone } from '@tutak/design/web';
import { Badge, Button, Field, Input, PageHeader, Surface, Textarea } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { integrationsApi } from '@/lib/api/integrationsApi';

function statusTone(status: PartnerIntegrationStatus): BadgeTone {
  if (status === PartnerIntegrationStatus.ACTIVE) return 'available';
  if (status === PartnerIntegrationStatus.PENDING_VERIFICATION) return 'pending';
  if (status === PartnerIntegrationStatus.SUSPENDED) return 'danger';
  return 'neutral';
}

function statusLabel(status: PartnerIntegrationStatus): string {
  switch (status) {
    case PartnerIntegrationStatus.ACTIVE:
      return 'Active';
    case PartnerIntegrationStatus.PENDING_VERIFICATION:
      return 'Pending verification';
    case PartnerIntegrationStatus.SUSPENDED:
      return 'Suspended';
    default:
      return 'Not connected';
  }
}

/**
 * One row per `PartnerIntegrationType`. WEBSITE is the only type with a
 * self-service action beyond "request it" — everything else genuinely has no
 * activation path today (`PartnerIntegrationsService` only implements
 * `markWebsiteVerified`, and it's platform-admin-only), so this page does not
 * pretend otherwise: a request just records intent for TuTak's team to
 * follow up on, the same way the backend already models it.
 */
const TYPE_META: Record<
  PartnerIntegrationType,
  { label: string; description: string; requiresUrl: boolean; builtIn: boolean }
> = {
  [PartnerIntegrationType.QR_PURCHASE]: {
    label: 'QR purchases',
    description: 'Included by default — every partner accepts QR-based purchases through the app. No setup needed.',
    requiresUrl: false,
    builtIn: true,
  },
  [PartnerIntegrationType.WEBSITE]: {
    label: 'Website',
    description:
      'Add your website address. Our team verifies it by hand before it goes live — no automatic check runs on the URL you enter.',
    requiresUrl: true,
    builtIn: false,
  },
  [PartnerIntegrationType.API]: {
    label: 'API',
    description:
      'Direct API integration for your own systems. Requires a technical specification from your TuTak account manager — request it and we’ll reach out to set it up.',
    requiresUrl: false,
    builtIn: false,
  },
  [PartnerIntegrationType.POS]: {
    label: 'POS',
    description:
      'Connect your point-of-sale system. Requires coordination with your POS vendor and your TuTak account manager — request it to start that conversation.',
    requiresUrl: false,
    builtIn: false,
  },
  [PartnerIntegrationType.EV_CHARGING]: {
    label: 'EV charging',
    description:
      'Charging sessions at your registered stations already work today (see EV stations). This entry is only for automatic transaction finalization via a direct system integration — request it if you want that.',
    requiresUrl: false,
    builtIn: false,
  },
  [PartnerIntegrationType.OCPI]: {
    label: 'OCPI',
    description:
      'Roaming charge-point interoperability for EV networks. Requires your OCPI endpoint specification — request it and your account manager will follow up.',
    requiresUrl: false,
    builtIn: false,
  },
};

const REQUESTABLE_TYPES = Object.values(PartnerIntegrationType).filter(
  (type) => !TYPE_META[type].builtIn,
);

function RequestForm({
  type,
  partnerId,
  onDone,
}: {
  type: PartnerIntegrationType;
  partnerId: string;
  onDone: () => void;
}) {
  const meta = TYPE_META[type];
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () =>
      integrationsApi.create(partnerId, {
        type,
        websiteUrl: meta.requiresUrl ? websiteUrl : undefined,
        configuration: !meta.requiresUrl && note ? { note } : undefined,
      }),
    onSuccess: onDone,
    onError: () => setError('Could not submit this request. Please try again.'),
  });

  const canSubmit = meta.requiresUrl ? websiteUrl.trim().length > 3 : true;

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {meta.requiresUrl ? (
        <Field label="Website URL">
          <Input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://your-business.am"
          />
        </Field>
      ) : (
        <Field label="Note (optional)" hint="Anything your account manager should know — POS vendor, preferred contact, etc.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      )}
      {error ? <p className="text-[13px] text-danger-text">{error}</p> : null}
      <Button size="sm" onClick={() => request.mutate()} loading={request.isPending} disabled={!canSubmit}>
        {meta.requiresUrl ? 'Submit for verification' : 'Request integration'}
      </Button>
    </div>
  );
}

function IntegrationCard({
  type,
  existing,
  partnerId,
}: {
  type: PartnerIntegrationType;
  existing: PartnerIntegrationDto | undefined;
  partnerId: string;
}) {
  const meta = TYPE_META[type];
  const queryClient = useQueryClient();
  const [requesting, setRequesting] = useState(false);

  return (
    <Surface>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[17px] font-semibold text-ink">{meta.label}</div>
          <p className="mt-1 max-w-xl text-[13px] text-muted">{meta.description}</p>
          {existing?.websiteUrl ? (
            <p className="tabular mt-2 text-[13px] text-ink">{existing.websiteUrl}</p>
          ) : null}
          {existing?.status === PartnerIntegrationStatus.ACTIVE && existing.websiteVerifiedAt ? (
            <p className="mt-1 text-[12px] text-faint">
              Verified {new Date(existing.websiteVerifiedAt).toLocaleDateString()}
            </p>
          ) : null}
          {existing?.configuration &&
          typeof existing.configuration === 'object' &&
          'note' in existing.configuration ? (
            <p className="mt-1 text-[12px] text-faint">Note: {String(existing.configuration.note)}</p>
          ) : null}
        </div>
        {meta.builtIn ? (
          <Badge tone="available">Built in</Badge>
        ) : existing ? (
          <Badge tone={statusTone(existing.status)}>{statusLabel(existing.status)}</Badge>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}>
            {meta.requiresUrl ? 'Connect' : 'Request'}
          </Button>
        )}
      </div>

      {!meta.builtIn && !existing && requesting ? (
        <RequestForm
          type={type}
          partnerId={partnerId}
          onDone={() => {
            setRequesting(false);
            queryClient.invalidateQueries({ queryKey: ['partner-integrations', partnerId] });
          }}
        />
      ) : null}
    </Surface>
  );
}

export default function IntegrationsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data } = useQuery({
    queryKey: ['partner-integrations', partnerId],
    queryFn: () => integrationsApi.list(partnerId!),
    enabled: !!partnerId,
  });

  const byType = new Map<PartnerIntegrationType, PartnerIntegrationDto>();
  for (const row of data ?? []) {
    // Newest first (the API already orders this way) — keep the first one seen per type.
    if (!byType.has(row.type)) byType.set(row.type, row);
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="How your business connects to TuTak — from the built-in QR flow to a direct API or POS integration."
      />

      <div className="space-y-4">
        <IntegrationCard
          type={PartnerIntegrationType.QR_PURCHASE}
          existing={byType.get(PartnerIntegrationType.QR_PURCHASE)}
          partnerId={partnerId ?? ''}
        />
        {REQUESTABLE_TYPES.map((type) => (
          <IntegrationCard key={type} type={type} existing={byType.get(type)} partnerId={partnerId ?? ''} />
        ))}
      </div>
    </>
  );
}
