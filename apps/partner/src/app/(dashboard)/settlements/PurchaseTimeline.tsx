'use client';

import { useQuery } from '@tanstack/react-query';
import type { PurchaseHistoryActorDto, PurchaseHistoryEventTypeDto } from '@tutak/shared-types';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice } from '@/lib/components/DataStatus';

const moment = (iso: string) => new Date(iso).toLocaleString('en-GB');

const EVENT_TEXT: Record<PurchaseHistoryEventTypeDto, string> = {
  CREATED: 'Customer opened this purchase',
  MERCHANT_APPROVED: 'Line item agreed at your side',
  PROVIDER_PAYMENT_STARTED: 'Payment started with the provider',
  PROVIDER_PAYMENT_CONFIRMED: 'Provider reported the money arrived',
  PROVIDER_PAYMENT_FAILED: 'Provider payment failed',
  CONFIRMED: 'Purchase confirmed',
  REJECTED: 'Purchase turned away',
  CANCELLED: 'Customer withdrew it',
  EXPIRED: 'Time ran out',
  REFUND_REQUESTED: 'Refund requested',
  REFUND_REQUEST_REJECTED: 'Refund request turned down',
  REFUNDED: 'Refunded',
  EXTERNAL_REFUND_CONFIRMED: 'Money returned to the customer, confirmed',
};

/**
 * Who did it, in words.
 *
 * The two staff cases read differently on purpose. A frozen code is what
 * the purchase recorded that day; a code looked up now is labelled as such,
 * because the person may have changed branch or role since and the screen
 * must not imply the old row said so.
 */
function actorText(actor: PurchaseHistoryActorDto): string {
  switch (actor.kind) {
    case 'CUSTOMER':
      return 'The customer';
    case 'STAFF':
      if (actor.frozen) {
        return actor.role
          ? `${actor.employeeCode} (${actor.role.toLowerCase().replace(/_/g, ' ')}, as recorded then)`
          : `${actor.employeeCode} (as recorded then)`;
      }
      return actor.employeeCode
        ? `${actor.employeeCode} (your staff today)`
        : 'Somebody on your staff, with no permanent code issued';
    case 'INTEGRATION':
      return 'Your own till integration';
    case 'PROVIDER':
      return actor.provider ? `The payment provider (${actor.provider})` : 'The payment provider';
    case 'TUTAK':
      return 'TuTak';
    case 'SYSTEM':
      return 'Nobody — a deadline passed';
    case 'NOT_RECORDED':
      // The one line that must never be filled in. See the DTO's docblock.
      return 'Not recorded';
  }
}

/** Only the fields worth printing. Ids stay out of the sentence. */
const DETAIL_LABEL: Record<string, string> = {
  amount: 'Amount',
  reason: 'Reason',
  note: 'Note',
  grossAmount: 'Sold for',
};

/**
 * The whole life of one sale, not just who confirmed it.
 *
 * A screen that reads "confirmed by EMP-004" and stops there answers a
 * different question from the one a partner usually has: the same purchase
 * may have been agreed by one person, paid through a provider, and refunded
 * by a third a week later. Each of those is its own line here, with its own
 * actor, and a gap in the record is shown as a gap.
 */
export function PurchaseTimeline({ purchaseIntentId }: { purchaseIntentId: string }) {
  const query = useQuery({
    queryKey: ['purchase-history', purchaseIntentId],
    queryFn: () => purchaseIntentApi.history(purchaseIntentId),
  });
  const state = dataStateOf(query);

  if (state === 'loading') return <LoadingNotice label="Loading what happened…" />;
  if (state === 'error') {
    return (
      <LoadError
        title="The history of this sale could not be loaded"
        onRetry={() => void query.refetch()}
        busy={query.isFetching}
      />
    );
  }

  const events = query.data?.events ?? [];
  if (events.length === 0) {
    return <p className="text-[12px] text-faint">Nothing is recorded against this sale.</p>;
  }

  return (
    <ol className="space-y-2">
      {events.map((event, index) => (
        <li key={`${event.type}-${event.at}-${index}`} className="text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted">{moment(event.at)}</span>
            <span className="font-medium text-ink">{EVENT_TEXT[event.type] ?? event.type}</span>
            <span className="text-muted">— {actorText(event.actor)}</span>
          </div>
          {Object.entries(event.detail)
            .filter(([key, value]) => value !== null && DETAIL_LABEL[key])
            .map(([key, value]) => (
              <div key={key} className="text-[12px] text-faint">
                {DETAIL_LABEL[key]}: {value}
              </div>
            ))}
        </li>
      ))}
    </ol>
  );
}
