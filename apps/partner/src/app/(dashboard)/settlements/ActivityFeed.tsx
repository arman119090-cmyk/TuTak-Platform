'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import type { PartnerActivityState } from '@tutak/shared-types';
import { settlementApi } from '@/lib/api/financeApi';
import { partnerApi } from '@/lib/api/partnerApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';
import { PurchaseBreakdownPanel } from './PurchaseBreakdownPanel';
import { localDay } from '@/lib/dates';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


const STATE_TONE: Record<PartnerActivityState, 'available' | 'pending' | 'reserved' | 'neutral'> = {
  UNSETTLED: 'neutral',
  IN_SETTLEMENT: 'pending',
  UNDER_REVIEW: 'reserved',
  PAID: 'available',
};

/**
 * The ledger kind a partner reads, in their own language.
 *
 * Keyed by the kind exactly as stored, so a kind nobody has named yet falls
 * through to "other activity" rather than disappearing — and the raw kind
 * stays on the row beside it, because a partner querying a line needs to
 * quote something TuTak can look up.
 */
const KNOWN_KINDS = new Set([
  'partner.bonus_redemption_compensation',
  'partner.bonus_redemption_compensation_refund',
  'partner.prepaid_funding',
  'partner.prepaid_funding_refund',
  'partner.contribution',
  'partner.contribution_refund',
  'psp.payment.captured',
  'psp.payment.refunded',
  'partner.collection.recorded',
  'partner.collection.confirmed',
  'partner.settlement.paid',
  'payout.requested',
  'payout.failed',
  'referral.commission',
  'ev.cdr.reconciliation',
]);

export function kindKey(kind: string): string {
  return KNOWN_KINDS.has(kind) ? `partnerPanel.kind.${kind}` : 'partnerPanel.kind.other';
}

const PAGE_SIZE = 25;

type Filters = {
  from: string;
  to: string;
  branchId: string;
  state: '' | PartnerActivityState;
};

const EMPTY: Filters = { from: '', to: '', branchId: '', state: '' };

/**
 * Every movement on the partner's own account.
 *
 * The settlements table above it answers "what was in the transfers you
 * sent me". This answers the question that comes first — "where did this
 * figure come from" — and it has to cover the movements no settlement has
 * claimed yet, the ones a draft is holding, and the transfers themselves.
 *
 * ## Paging forward with a cursor, back with a stack
 *
 * The server pages by keyset, so there is no page number to jump to and
 * that is deliberate: new postings land on this account while somebody is
 * reading, and a numbered page would quietly move rows across boundaries.
 * Going back is a stack of the cursors already used rather than a
 * subtraction, which is the only honest way to reverse a keyset walk.
 *
 * ## The totals under a filter are the filter's
 *
 * `selection` is printed under the table, labelled as the selection, and
 * never in the tiles at the top of the page. "The six sales at this branch
 * in March net to 18 000" is not a statement about what TuTak owes the
 * business, and a screen that puts those two numbers in the same kind of
 * box invites exactly that reading.
 */
export function ActivityFeed({ partnerId }: { partnerId: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  // The cursor for the page on screen, and the ones that led to it.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [back, setBack] = useState<(string | undefined)[]>([]);
  const [openPurchase, setOpenPurchase] = useState<{ id: string; reference: string } | null>(null);

  const branchesQuery = useQuery({
    queryKey: ['partner-branches-for-activity', partnerId],
    // Archived branches included: a closed shop still made the sales that
    // are in this list, and a filter that cannot name it makes those rows
    // unreachable.
    queryFn: () => partnerApi.listBranches(partnerId, true),
  });

  const query = useQuery({
    queryKey: ['partner-activity', partnerId, applied, cursor],
    queryFn: () =>
      settlementApi.activity(partnerId, {
        from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : undefined,
        to: applied.to ? new Date(`${applied.to}T23:59:59.999`).toISOString() : undefined,
        branchId: applied.branchId || undefined,
        state: applied.state || undefined,
        cursor,
        limit: PAGE_SIZE,
      }),
    // The page already on screen stays there while the next one loads.
    // Dropping to a spinner would take the table and both paging buttons
    // with it, so the control somebody just pressed disappears under their
    // cursor and the page jumps. The buttons are disabled while fetching,
    // which says "working" without moving anything.
    placeholderData: (previous) => previous,
  });
  const state = dataStateOf(query);
  const page = query.data;

  const apply = () => {
    setApplied(draft);
    setCursor(undefined);
    setBack([]);
    setOpenPurchase(null);
  };

  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setCursor(undefined);
    setBack([]);
    setOpenPurchase(null);
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{t('partnerPanel.activity.title')}</h2>
        <p className="text-[13px] text-muted">{t('partnerPanel.activity.description')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('partnerPanel.activity.from')}>
          <Input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label={t('partnerPanel.activity.to')}>
          <Input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label={t('partnerPanel.activity.shop')}>
          <Select
            value={draft.branchId}
            onChange={(e) => setDraft({ ...draft, branchId: e.target.value })}
          >
            <option value="">{t('partnerPanel.activity.allShops')}</option>
            {(branchesQuery.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('partnerPanel.activity.whereMoneyIs')}>
          <Select
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value as Filters['state'] })}
          >
            <option value="">{t('partnerPanel.activity.anywhere')}</option>
            {(['UNSETTLED', 'IN_SETTLEMENT', 'UNDER_REVIEW', 'PAID'] as const).map((state) => (
              <option key={state} value={state}>
                {t(`partnerPanel.activityState.${state}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={apply}>{t('partnerPanel.common.apply')}</Button>
        <Button variant="secondary" onClick={clear}>
          {t('partnerPanel.common.showEverything')}
        </Button>
      </div>

      {state === 'loading' ? <LoadingNotice label={t('partnerPanel.common.loading')} /> : null}
      {state === 'error' ? (
        <LoadError
          title={t('partnerPanel.activity.loadError')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}
      {state === 'stale' ? (
        <StaleNotice
          asOf={query.dataUpdatedAt}
          what={t('partnerPanel.stale.whatActivity')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}

      {page && page.rows.length === 0 ? (
        <EmptyState
          title={t('partnerPanel.activity.emptyTitle')}
          message={
            page.filtered
              ? t('partnerPanel.activity.emptyFiltered')
              : t('partnerPanel.activity.emptyAll')
          }
        />
      ) : null}

      {page && page.rows.length > 0 ? (
        <>
          <Table>
            <thead>
              <Tr>
                <Th>{t('partnerPanel.activity.date')}</Th>
                <Th>{t('partnerPanel.activity.number')}</Th>
                <Th>{t('partnerPanel.activity.what')}</Th>
                <Th>{t('partnerPanel.activity.shop')}</Th>
                <Th>{t('partnerPanel.activity.confirmedBy')}</Th>
                <Th>{t('partnerPanel.activity.debtChange')}</Th>
                <Th>{t('partnerPanel.activity.whereItIs')}</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {page.rows.map((row) => {
                const change = Number(row.debtChange);
                return (
                  <Tr key={row.postingId}>
                    <Td>{localDay(row.occurredAt)}</Td>
                    {/* What a partner quotes when they query this line. */}
                    <Td>
                      <span className="font-mono text-[12px]">{row.reference}</span>
                    </Td>
                    <Td>
                      <div>{t(kindKey(row.kind))}</div>
                      <div className="font-mono text-[11px] text-faint">{row.kind}</div>
                    </Td>
                    {/* The shop, by name. The business is the one being
                        looked at; repeating it on every row buries the
                        figures the row exists to show. */}
                    <Td>{row.branch ?? <span className="text-faint">—</span>}</Td>
                    <Td>
                      {/* The code links to the person's card, because the
                          question after "who confirmed this" is always "who
                          is that". */}
                      {row.employeeCode ? (
                        <Link
                          href={`/employees/${encodeURIComponent(row.employeeCode)}`}
                          className="font-mono text-[12px] underline"
                        >
                          {row.employeeCode}
                        </Link>
                      ) : row.confirmationSource === 'PROVIDER' ? (
                        <span className="text-[12px] text-muted">
                          {t('partnerPanel.activity.provider')}
                        </span>
                      ) : row.confirmationSource === 'INTEGRATION' ? (
                        <span className="text-[12px] text-muted">
                          {t('partnerPanel.activity.integration')}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className={change < 0 ? 'text-danger-text' : undefined}>
                        {change > 0 ? '+' : ''}
                        {money(row.debtChange)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={STATE_TONE[row.state]}>
                        {t(`partnerPanel.activityState.${row.state}`)}
                      </Badge>
                    </Td>
                    <Td>
                      {row.itemisable ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setOpenPurchase(
                              openPurchase?.id === row.sourceId
                                ? null
                                : { id: row.sourceId, reference: row.reference },
                            )
                          }
                        >
                          {openPurchase?.id === row.sourceId
                            ? t('partnerPanel.activity.hideBreakdown')
                            : t('partnerPanel.activity.openBreakdown')}
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>

          {/*
            The selection's own totals, kept away from the tiles above and
            labelled as the selection. Without the label a filtered subtotal
            reads as a balance, which is the single most expensive thing this
            screen could get wrong.
          */}
          <div className="rounded-md border border-subtle p-3 text-[13px]">
            <div className="font-medium text-ink">
              {page.filtered
                ? t('partnerPanel.activity.selectionFiltered')
                : t('partnerPanel.activity.selectionAll')}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-muted">
              <span>{t('partnerPanel.activity.lines', { count: page.selection.rowCount })}</span>
              <span>
                {t('partnerPanel.activity.credits', { amount: money(page.selection.credits) })}
              </span>
              <span>{t('partnerPanel.activity.debits', { amount: money(page.selection.debits) })}</span>
              <span className="text-ink">
                {t('partnerPanel.activity.net', { amount: money(page.selection.net) })}
              </span>
            </div>
            {page.filtered ? (
              <p className="mt-1 text-[12px] text-faint">
                {t('partnerPanel.activity.notThePosition')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={back.length === 0 || query.isFetching}
              onClick={() => {
                setBack((stack) => {
                  const next = [...stack];
                  setCursor(next.pop());
                  return next;
                });
                setOpenPurchase(null);
              }}
            >
              {t('partnerPanel.common.previous')}
            </Button>
            <Button
              variant="secondary"
              disabled={!page.nextCursor || query.isFetching}
              onClick={() => {
                setBack((stack) => [...stack, cursor]);
                setCursor(page.nextCursor ?? undefined);
                setOpenPurchase(null);
              }}
            >
              {t('partnerPanel.common.next')}
            </Button>
            <span className="text-[12px] text-faint">
              {t('partnerPanel.activity.pageSize', { count: PAGE_SIZE })}
            </span>
          </div>
        </>
      ) : null}

      {openPurchase ? (
        <PurchaseBreakdownPanel
          partnerId={partnerId}
          purchaseIntentId={openPurchase.id}
          reference={openPurchase.reference}
          onClose={() => setOpenPurchase(null)}
        />
      ) : null}
    </section>
  );
}
