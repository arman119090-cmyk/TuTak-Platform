'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import type { PartnerDto } from '@tutak/shared-types';
import { partnersApi } from '@/lib/api/partnersApi';

/**
 * The queue of businesses asking to join.
 *
 * ## Why this is its own page
 *
 * An application and a partner are different objects to work with. A partner
 * is something you look up; an application is something you work through and
 * finish. Mixed into the partners table they were invisible — that table's
 * "Status" column reports `isActive`, not `status`, so an application in
 * `PENDING_APPROVAL` sat there looking like an ordinary inactive partner,
 * with no way to tell that someone was waiting on an answer.
 *
 * ## What approving decides
 *
 * The rate is the applicant's own proposal and approving accepts it as it
 * stands. That is deliberate: the number was agreed with the business before
 * they filled the form in, so a second place to type a different one would
 * only be a place to disagree with the agreement by accident. To trade on a
 * different rate, approve first and change it on the partner.
 *
 * Until approval the partner exists but can do nothing — `findActiveOrThrow`
 * refuses it everywhere, so no QR, no charging session and no purchase can
 * run against a business sitting in this list.
 */
export default function PartnerApplicationsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['partners'],
    queryFn: partnersApi.list,
  });

  const pending = (data ?? []).filter((p) => p.status === 'PENDING_APPROVAL');

  return (
    <>
      <PageHeader
        title="Partner applications"
        description="Businesses that applied from the app and are waiting for an answer. Nothing they do counts until you approve them."
      />

      <Surface>
        {isLoading ? (
          <EmptyState title="Loading applications…" />
        ) : isError ? (
          <EmptyState
            title="Could not load applications"
            message="The list did not arrive, so it is not shown — an empty table here would read as 'nobody is waiting'."
            action={<Button onClick={() => void refetch()}>Try again</Button>}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            title="No applications waiting"
            message="New applications from the app appear here."
          />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Business</Th>
                <Th>Category</Th>
                <Th>Tax ID</Th>
                <Th align="right">Proposed cashback</Th>
                <Th align="right">Decision</Th>
              </Tr>
            </thead>
            <tbody>
              {pending.map((partner) => (
                <ApplicationRow key={partner.id} partner={partner} />
              ))}
            </tbody>
          </Table>
        )}
      </Surface>
    </>
  );
}

function ApplicationRow({ partner }: { partner: PartnerDto }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    // Both lists are built from this one query, so the partners table and
    // this queue cannot disagree about what was just decided.
    queryClient.invalidateQueries({ queryKey: ['partners'] });
  };

  const approve = useMutation({
    mutationFn: () => partnersApi.approve(partner.id),
    onSuccess: done,
    onError: () => setError('Could not approve this application. Please try again.'),
  });

  const reject = useMutation({
    mutationFn: () => partnersApi.reject(partner.id, reason.trim()),
    onSuccess: () => {
      setRejecting(false);
      setReason('');
      done();
    },
    onError: () => setError('Could not reject this application. Please try again.'),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <>
      <Tr>
        <Td>
          <div className="font-medium text-ink">{partner.displayName}</div>
          <div className="text-[12px] text-faint">{partner.legalName}</div>
        </Td>
        <Td className="text-muted">{partner.category}</Td>
        <Td className="text-muted">
          {partner.taxId ? (
            <span className="tabular">{partner.taxId}</span>
          ) : (
            // Not an error and not a reason to refuse: the form lets an
            // applicant skip it, and they can add it from their own panel.
            // Marked so you can see at a glance who still owes you one.
            <Badge tone="neutral">Not given</Badge>
          )}
        </Td>
        <Td align="right" className="tabular">
          {(partner.bonusAccrualRateBps / 100).toFixed(2)}%
        </Td>
        <Td align="right">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="tertiary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setRejecting((v) => !v);
              }}
            >
              {rejecting ? 'Cancel' : 'Reject'}
            </Button>
            <Button
              size="sm"
              loading={approve.isPending}
              disabled={busy}
              onClick={() => {
                setError(null);
                approve.mutate();
              }}
            >
              Approve
            </Button>
          </div>
        </Td>
      </Tr>

      {rejecting ? (
        <Tr>
          <Td colSpan={5}>
            <div className="flex flex-wrap items-end gap-3">
              {/* Required by the server, and rightly: a rejection with no
                  reason is one nobody can explain to the business later. */}
              <div className="min-w-[280px] flex-1">
                <Field label="Why is this being rejected?">
                  <Input
                    value={reason}
                    maxLength={500}
                    autoFocus
                    disabled={reject.isPending}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
              <Button
                size="sm"
                variant="destructive"
                loading={reject.isPending}
                disabled={reason.trim().length === 0 || reject.isPending}
                onClick={() => {
                  setError(null);
                  reject.mutate();
                }}
              >
                Confirm rejection
              </Button>
            </div>
          </Td>
        </Tr>
      ) : null}

      {error ? (
        <Tr>
          <Td colSpan={5}>
            <div className="text-[13px] text-danger">{error}</div>
          </Td>
        </Tr>
      ) : null}
    </>
  );
}
