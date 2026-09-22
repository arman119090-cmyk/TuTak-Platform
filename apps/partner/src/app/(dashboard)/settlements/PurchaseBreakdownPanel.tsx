'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '@tutak/design/web';
import type { PurchaseBreakdownDto } from '@tutak/shared-types';
import { settlementApi } from '@/lib/api/financeApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';
import { PurchaseTimeline } from './PurchaseTimeline';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const moment = (iso: string) => new Date(iso).toLocaleString('en-GB');

const LINE_TONE: Record<string, 'available' | 'pending' | 'neutral'> = {
  UNSETTLED: 'neutral',
  IN_SETTLEMENT: 'pending',
  PAID: 'available',
};

/**
 * What one sale did to the debt.
 *
 * The statement answers "why do you owe me this much" with days and totals.
 * This is the next question, asked about a single line, and a partner who
 * can reach it can check a figure against their own contract instead of
 * arguing with it.
 *
 * ## The three amounts at the bottom are not one amount
 *
 * "Still owed", "held by a settlement" and "paid" are three different facts
 * about the same sale, and collapsing them is how a screen ends up telling
 * somebody a transfer happened because an administrator wrote a draft. They
 * are shown side by side, labelled, and never summed into a headline.
 *
 * ## What is deliberately not here
 *
 * The pool split — what TuTak keeps and what it pays referrers — is not the
 * partner's business and is not in the server's answer either. There is
 * nothing to hide on this side because there is nothing to hide.
 */
export function PurchaseBreakdownPanel({
  partnerId,
  purchaseIntentId,
  reference,
  onClose,
}: {
  partnerId: string;
  purchaseIntentId: string;
  reference: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['partner-purchase-breakdown', partnerId, purchaseIntentId],
    queryFn: () => settlementApi.purchaseBreakdown(partnerId, purchaseIntentId),
  });
  const state = dataStateOf(query);
  const breakdown = query.data;

  return (
    <section className="space-y-3 rounded-lg border border-subtle p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The reference is monospaced as a whole, not spliced into the
            sentence: which side of the word the number sits on differs by
            language, and a component-splitting translation would have to be
            got right in three of them to avoid a broken heading. */}
        <h2 className="text-[14px] font-medium">
          <span className="font-mono">
            {t('partnerPanel.breakdown.heading', { reference })}
          </span>
        </h2>
        <Button variant="secondary" onClick={onClose}>
          {t('partnerPanel.common.close')}
        </Button>
      </div>

      {state === 'loading' ? <LoadingNotice label={t('partnerPanel.breakdown.loading')} /> : null}
      {state === 'error' ? (
        <LoadError
          title={t('partnerPanel.breakdown.loadError')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}
      {state === 'stale' ? (
        <StaleNotice
          asOf={query.dataUpdatedAt}
          what={t('partnerPanel.stale.whatSale')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}

      {breakdown ? <BreakdownBody breakdown={breakdown} /> : null}

      {/*
        What happened, next to what is owed. The single `confirmation` on a
        purchase answers "who moved it to confirmed" and nothing else, and
        that was starting to be read as the whole story.
      */}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink">
          {t('partnerPanel.timeline.heading')}
        </h3>
        <PurchaseTimeline purchaseIntentId={purchaseIntentId} />
      </div>
    </section>
  );
}

function BreakdownBody({ breakdown }: { breakdown: PurchaseBreakdownDto }) {
  const { t } = useTranslation();
  const collectedByTuTak = breakdown.externalCollectedBy === 'TUTAK_VIA_PROVIDER';
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        <Row label={t('partnerPanel.breakdown.confirmed')}>
          {breakdown.confirmedAt
            ? moment(breakdown.confirmedAt)
            : t('partnerPanel.breakdown.notConfirmed')}
        </Row>
        <Row label={t('partnerPanel.breakdown.status')}>{breakdown.status}</Row>
        {/*
          Who confirmed it, as the row was frozen on the day — not looked up
          now. A person's code, or the plain statement that no person was
          involved. "Not recorded" is for the rows that predate the column
          and is never turned into a name.
        */}
        <Row label={t('partnerPanel.breakdown.confirmedBy')}>
          {breakdown.employeeCode ? (
            <span className="font-mono">{breakdown.employeeCode}</span>
          ) : breakdown.confirmationSource === 'PROVIDER' ? (
            t('partnerPanel.breakdown.byProvider')
          ) : breakdown.confirmationSource === 'INTEGRATION' ? (
            t('partnerPanel.breakdown.byIntegration')
          ) : (
            t('partnerPanel.breakdown.notRecorded')
          )}
        </Row>
        <Row label={t('partnerPanel.breakdown.soldFor')}>{money(breakdown.grossAmount)}</Row>
      </dl>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink">
          {t('partnerPanel.breakdown.whatPaid')}
        </h3>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <Row label={t('partnerPanel.breakdown.paidWithBonus')}>
            {money(breakdown.bonusApplied)}
          </Row>
          <Row label={t('partnerPanel.breakdown.paidFromBalance')}>
            {money(breakdown.prepaidApplied)}
          </Row>
          {/*
            The one line on this panel a partner most often misreads, so it
            names the holder rather than the method: money taken at their own
            till was never TuTak's and is not part of what TuTak owes.
          */}
          <Row
            label={t(
              collectedByTuTak
                ? 'partnerPanel.breakdown.collectedByProvider'
                : 'partnerPanel.breakdown.takenAtTill',
            )}
          >
            {money(breakdown.externalAmount)}
            <span className="ml-2 text-[12px] text-faint">
              {t(
                collectedByTuTak
                  ? 'partnerPanel.breakdown.tutakSettles'
                  : 'partnerPanel.breakdown.yoursAlready',
              )}
            </span>
          </Row>
          <Row label={t('partnerPanel.breakdown.refundedSince')}>
            {money(breakdown.refundedAmount)}
          </Row>
        </dl>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink">
          {t('partnerPanel.breakdown.whatItDid')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label={t('partnerPanel.breakdown.stillOwed')} value={breakdown.stillOwed} />
          <Figure
            label={t('partnerPanel.breakdown.heldBySettlement')}
            value={breakdown.inOpenSettlement}
            hint={t('partnerPanel.breakdown.heldHint')}
          />
          <Figure label={t('partnerPanel.breakdown.alreadyPaid')} value={breakdown.paid} />
        </div>
        <p className="mt-2 text-[12px] text-faint">
          {t('partnerPanel.breakdown.effect', { amount: money(breakdown.effectOnDebt) })}
        </p>
      </div>

      {breakdown.lines.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">
            {t('partnerPanel.breakdown.everyLine')}
          </h3>
          <ul className="space-y-1.5">
            {breakdown.lines.map((line, index) => (
              <li
                key={`${line.kind}-${line.occurredAt}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <span className="font-mono text-[12px] text-faint">{line.kind}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={LINE_TONE[line.state] ?? 'neutral'}>
                    {t(`partnerPanel.activityState.${line.state}`)}
                  </Badge>
                  <span>{money(line.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12px] text-faint">{t('partnerPanel.breakdown.noLines')}</p>
      )}

      {breakdown.refunds.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">
            {t('partnerPanel.breakdown.refunds')}
          </h3>
          <ul className="space-y-1 text-[13px]">
            {breakdown.refunds.map((refund) => (
              <li key={refund.id} className="flex justify-between gap-2">
                <span>{moment(refund.occurredAt)}</span>
                <span>{money(refund.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink sm:mt-0.5">{children}</dd>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-subtle p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-[17px] font-semibold text-ink">{money(value)}</div>
      {hint ? <div className="text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}
