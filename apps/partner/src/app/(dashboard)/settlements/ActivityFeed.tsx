'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const STATE_TEXT: Record<PartnerActivityState, { text: string; tone: 'available' | 'pending' | 'reserved' | 'neutral' }> = {
  UNSETTLED: { text: 'Not in a settlement yet', tone: 'neutral' },
  IN_SETTLEMENT: { text: 'Held by an unpaid settlement', tone: 'pending' },
  UNDER_REVIEW: { text: 'Under review', tone: 'reserved' },
  PAID: { text: 'Paid', tone: 'available' },
};

/**
 * What a ledger kind means to the person being paid. Same map as the
 * statement's, because the same posting must not have two names depending
 * on which screen a partner opens it from.
 */
const KIND_TEXT: Record<string, string> = {
  'partner.bonus_redemption_compensation': 'Bonus points a customer spent with you',
  'partner.bonus_redemption_compensation_refund': 'Refund of bonus points spent',
  'partner.prepaid_funding': 'Paid from a customer’s TuTak balance',
  'partner.prepaid_funding_refund': 'Refund of a TuTak balance payment',
  'partner.contribution': 'Your contribution to the bonus pool',
  'partner.contribution_refund': 'Contribution returned on a refund',
  'psp.payment.captured': 'Customer paid inside TuTak',
  'psp.payment.refunded': 'Refund of a TuTak payment',
  'partner.collection.recorded': 'Your transfer to TuTak, recorded',
  'partner.collection.confirmed': 'Your transfer to TuTak, confirmed',
  'partner.settlement.paid': 'TuTak transferred this to you',
  'payout.requested': 'Payout requested',
  'payout.failed': 'Payout bounced — returned to your balance',
  'referral.commission': 'Referral commission',
  'ev.cdr.reconciliation': 'Charging session settlement',
};

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
        <h2 className="text-[15px] font-semibold text-ink">Everything that moved your balance</h2>
        <p className="text-[13px] text-muted">
          Each line is one movement on your account: what it was, which shop it came from, who
          confirmed it, and what it did to what TuTak owes you.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From">
          <Input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label="Shop">
          <Select
            value={draft.branchId}
            onChange={(e) => setDraft({ ...draft, branchId: e.target.value })}
          >
            <option value="">All shops</option>
            {(branchesQuery.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Where the money is">
          <Select
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value as Filters['state'] })}
          >
            <option value="">Anywhere</option>
            <option value="UNSETTLED">Not in a settlement yet</option>
            <option value="IN_SETTLEMENT">Held by an unpaid settlement</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="PAID">Paid</option>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={apply}>Apply</Button>
        <Button variant="secondary" onClick={clear}>
          Show everything
        </Button>
      </div>

      {state === 'loading' ? <LoadingNotice label="Loading your account…" /> : null}
      {state === 'error' ? (
        <LoadError
          title="Your account could not be loaded"
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}
      {state === 'stale' ? (
        <StaleNotice
          asOf={query.dataUpdatedAt}
          what="this list"
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      ) : null}

      {page && page.rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          message={
            page.filtered
              ? 'No movement matches this filter. Clearing it shows the whole account.'
              : 'Nothing has moved on your account yet.'
          }
        />
      ) : null}

      {page && page.rows.length > 0 ? (
        <>
          <Table>
            <thead>
              <Tr>
                <Th>Date</Th>
                <Th>Number</Th>
                <Th>What</Th>
                <Th>Shop</Th>
                <Th>Confirmed by</Th>
                <Th>Change in what you are owed</Th>
                <Th>Where it is</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {page.rows.map((row) => {
                const change = Number(row.debtChange);
                return (
                  <Tr key={row.postingId}>
                    <Td>{day(row.occurredAt)}</Td>
                    {/* What a partner quotes when they query this line. */}
                    <Td>
                      <span className="font-mono text-[12px]">{row.reference}</span>
                    </Td>
                    <Td>
                      <div>{KIND_TEXT[row.kind] ?? 'Other activity'}</div>
                      <div className="font-mono text-[11px] text-faint">{row.kind}</div>
                    </Td>
                    {/* The shop, by name. The business is the one being
                        looked at; repeating it on every row buries the
                        figures the row exists to show. */}
                    <Td>{row.branch ?? <span className="text-faint">—</span>}</Td>
                    <Td>
                      {row.employeeCode ? (
                        <span className="font-mono text-[12px]">{row.employeeCode}</span>
                      ) : row.confirmationSource === 'PROVIDER' ? (
                        <span className="text-[12px] text-muted">Payment provider</span>
                      ) : row.confirmationSource === 'INTEGRATION' ? (
                        <span className="text-[12px] text-muted">Your till integration</span>
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
                      <Badge tone={STATE_TEXT[row.state].tone}>{STATE_TEXT[row.state].text}</Badge>
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
                          {openPurchase?.id === row.sourceId ? 'Hide' : 'Where is this from?'}
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
              {page.filtered ? 'Total of the lines you selected' : 'Total of every line on your account'}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-muted">
              <span>{page.selection.rowCount} lines</span>
              <span>Added to what you are owed: {money(page.selection.credits)}</span>
              <span>Taken off: {money(page.selection.debits)}</span>
              <span className="text-ink">Net: {money(page.selection.net)}</span>
            </div>
            {page.filtered ? (
              <p className="mt-1 text-[12px] text-faint">
                This is the total of the filter above, not what TuTak owes your business. That
                figure is at the top of this page.
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
              Previous
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
              Next
            </Button>
            <span className="text-[12px] text-faint">
              {PAGE_SIZE} lines at a time, newest first
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
