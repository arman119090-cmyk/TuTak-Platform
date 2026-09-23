'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PurchaseHistoryActorDto } from '@tutak/shared-types';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice } from '@/lib/components/DataStatus';

const moment = (iso: string) => new Date(iso).toLocaleString('en-GB');

/**
 * Who did it, in words.
 *
 * The two staff cases read differently on purpose. A frozen code is what
 * the purchase recorded that day; a code looked up now is labelled as such,
 * because the person may have changed branch or role since and the screen
 * must not imply the old row said so.
 */
function actorText(actor: PurchaseHistoryActorDto, t: TFunction): string {
  switch (actor.kind) {
    case 'CUSTOMER':
      return t('partnerPanel.timeline.actorCustomer');
    case 'STAFF':
      if (actor.frozen) {
        return actor.role
          ? t('partnerPanel.timeline.actorStaffFrozenWithRole', {
              code: actor.employeeCode,
              role: actor.role.toLowerCase().replace(/_/g, ' '),
            })
          : t('partnerPanel.timeline.actorStaffFrozen', { code: actor.employeeCode });
      }
      return actor.employeeCode
        ? t('partnerPanel.timeline.actorStaffNow', { code: actor.employeeCode })
        : t('partnerPanel.timeline.actorStaffNoCode');
    case 'INTEGRATION':
      return t('partnerPanel.timeline.actorIntegration');
    case 'PROVIDER':
      return actor.provider
        ? t('partnerPanel.timeline.actorProviderNamed', { provider: actor.provider })
        : t('partnerPanel.timeline.actorProvider');
    case 'TUTAK':
      return t('partnerPanel.timeline.actorTuTak');
    case 'SYSTEM':
      return t('partnerPanel.timeline.actorSystem');
    case 'NOT_RECORDED':
      // The one line that must never be filled in. See the DTO's docblock.
      return t('partnerPanel.timeline.actorNotRecorded');
  }
}

/** Only the fields worth printing. Ids stay out of the sentence. */
const DETAIL_KEYS = ['amount', 'reason', 'note', 'grossAmount'] as const;

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
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['purchase-history', purchaseIntentId],
    queryFn: () => purchaseIntentApi.history(purchaseIntentId),
  });
  const state = dataStateOf(query);

  if (state === 'loading') return <LoadingNotice label={t('partnerPanel.timeline.loading')} />;
  if (state === 'error') {
    return (
      <LoadError
        title={t('partnerPanel.timeline.loadError')}
        onRetry={() => void query.refetch()}
        busy={query.isFetching}
      />
    );
  }

  const events = query.data?.events ?? [];
  if (events.length === 0) {
    return <p className="text-[12px] text-faint">{t('partnerPanel.timeline.empty')}</p>;
  }

  return (
    <ol className="space-y-2">
      {events.map((event, index) => (
        <li key={`${event.type}-${event.at}-${index}`} className="text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted">{moment(event.at)}</span>
            <span className="font-medium text-ink">
              {t(`partnerPanel.timelineEvent.${event.type}`, { defaultValue: event.type })}
            </span>
            <span className="text-muted">— {actorText(event.actor, t)}</span>
          </div>
          {DETAIL_KEYS.filter((key) => event.detail[key]).map((key) => (
            <div key={key} className="text-[12px] text-faint">
              {t(`partnerPanel.timeline.${key}`)}: {event.detail[key]}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
