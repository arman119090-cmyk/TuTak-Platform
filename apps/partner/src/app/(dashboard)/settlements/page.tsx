'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { settlementApi } from '@/lib/api/financeApi';
import type { PartnerSettlementDto, UnsettledPositionDto } from '@tutak/shared-types';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { ActivityFeed } from './ActivityFeed';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const money = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Tone per settlement status.
 *
 * `FAILED` is amber rather than red on purpose: a bounced transfer does not
 * change what is owed, the entries stay claimed, and another transfer may be
 * attempted against the same figure. Painting it as a loss would tell the
 * partner their money is gone when it is not.
 */
const STATUS_TONE: Record<string, 'pending' | 'available' | 'danger' | 'neutral'> = {
  DRAFT: 'neutral',
  READY: 'pending',
  APPROVED: 'pending',
  PAYMENT_PENDING: 'pending',
  PAID: 'available',
  FAILED: 'pending',
  REQUIRES_RECONCILIATION: 'danger',
  CANCELLED: 'neutral',
};

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Being prepared — not paid yet',
  READY: 'Awaiting approval — not paid yet',
  APPROVED: 'Approved for transfer — not paid yet',
  PAYMENT_PENDING: 'Transfer sent, not yet landed',
  PAID: 'Paid',
  FAILED: 'Transfer bounced — still owed',
  REQUIRES_RECONCILIATION: 'Unclear — being checked',
  CANCELLED: 'Cancelled',
};

/**
 * What a ledger posting kind means to the person being paid.
 *
 * The code stays on the line next to it: a partner querying a line needs to
 * quote something TuTak can look up, and a translated name is not that. What
 * changed is that they no longer have to read the code to know what it was.
 */
const ENTRY_KIND_TEXT: Record<string, string> = {
  'partner.bonus_redemption_compensation': 'Bonus points a customer spent with you',
  'partner.bonus_redemption_compensation_refund': 'Refund of bonus points spent',
  'partner.contribution': 'Your contribution to the bonus pool',
  'partner.contribution_refund': 'Contribution returned on a refund',
  'psp.payment.captured': 'Customer paid in TuTak',
  'psp.payment.refunded': 'Refund of a TuTak payment',
  'referral.commission': 'Referral commission',
  'ev.cdr.reconciliation': 'Charging session settlement',
};

const entryKindText = (kind: string) => ENTRY_KIND_TEXT[kind] ?? 'Other activity';

/**
 * What TuTak owes this partner, and every statement of it.
 *
 * Read-only, and that is the design rather than a missing feature. A partner
 * is the payee; a payee who can adjust their own Net Position is not a payee.
 * Drafting, approving and marking a settlement paid all happen on the TuTak
 * side and all take two different people.
 *
 * ## The figures, and why there are five
 *
 * `position.net` is only what is not yet inside any settlement. It reads
 * zero the moment an administrator drafts a settlement, and nothing has been
 * paid at that moment. So the page leads with the ledger total and shows
 * where that total currently sits — not yet settled, held in unpaid
 * settlements, under review — and lists what has actually been paid as
 * history. The four never overlap and are never added up on this page: the
 * server states the identity, the page only prints it.
 *
 * ## Nothing is a number until it has been received
 *
 * A tile shows `—` while its figure is loading and `—` with "could not load"
 * when the request failed. `?? '0'` used to turn an unreachable API into a
 * balance of zero, which on a payee's screen is a statement that they are
 * owed nothing. A figure that arrived once and then stopped refreshing stays
 * on screen with the time it was true.
 *
 * The one control here is reporting a problem with a transfer. It deliberately
 * asserts nothing about whether money moved — it says "this does not look
 * right to me" and hands the question to finance, who need two people to
 * answer it. A button letting a partner declare a transfer missing would be a
 * button letting the payee decide a payment question about themselves.
 */
export default function SettlementsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const queryClient = useQueryClient();

  const positionQuery = useQuery({
    queryKey: ['partner-position', partnerId],
    queryFn: () => settlementApi.position(partnerId!),
    enabled: !!partnerId,
  });
  const position = positionQuery.data;
  const positionState = dataStateOf(positionQuery);

  const statementsQuery = useQuery({
    queryKey: ['partner-statements', partnerId],
    queryFn: () => settlementApi.statements(partnerId!),
    enabled: !!partnerId,
  });
  const statements = statementsQuery.data;
  const statementsState = dataStateOf(statementsQuery);

  /*
   * The itemisation, opened one settlement at a time.
   *
   * This was missing, and its absence made the rest of the screen weaker
   * than it looked: a partner could see the figure they were paid and had no
   * way to see what it was made of. A number with no breakdown is a number
   * you can only argue with — which is exactly what the API's own note said
   * the itemisation exists to prevent.
   */
  const [openStatement, setOpenStatement] = useState<string | null>(null);

  const statementQuery = useQuery({
    queryKey: ['partner-statement', partnerId, openStatement],
    queryFn: () => settlementApi.statement(partnerId!, openStatement!),
    enabled: !!partnerId && !!openStatement,
  });
  const statement = statementQuery.data;
  const statementState = dataStateOf(statementQuery);

  const [reporting, setReporting] = useState<PartnerSettlementDto | null>(null);
  const [reason, setReason] = useState('');

  const report = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      settlementApi.reportProblem(partnerId!, input.id, input.reason),
    onSuccess: () => {
      setReporting(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['partner-statements', partnerId] });
    },
  });

  if (!partnerId) {
    return <EmptyState title="No business" message="This account is not attached to a business." />;
  }

  /** A tile's value and caption for the state its figure is in. */
  const figure = (value: (p: UnsettledPositionDto) => string, caption: string) => {
    if (positionState === 'loading') return { value: '—', hint: 'Loading…' };
    if (positionState === 'error') return { value: '—', hint: 'Could not load' };
    return { value: money(value(position!)), hint: caption };
  };

  const total = position ? Number(position.ledgerBalance) : null;
  const owedToYou = total !== null && total > 0;
  const youOwe = total !== null && total < 0;
  // The third state, and the reason it is named rather than left to be
  // inferred: a balance of zero and a screen that failed to load both print
  // "0.00" under "TuTak owes you", and only one of them means the two sides
  // are square. `positionState` decides which, and a figure that never
  // arrived is a dash, never a nil balance.
  const settledUp = total !== null && total === 0;

  const totalTile = figure(
    (p) => (Number(p.ledgerBalance) < 0 ? String(-Number(p.ledgerBalance)) : p.ledgerBalance),
    youOwe
      ? 'You transfer this to TuTak; TuTak records it'
      : 'From the ledger. Includes the three below',
  );
  const unsettledTile = figure((p) => p.net, 'Nobody has drafted a settlement for this yet');
  const openTile = figure((p) => p.inOpenSettlements, 'Claimed by settlements that have not been paid');
  const paidTile = figure((p) => p.paidTotal, 'Already transferred; not part of the total');
  const reviewTile = figure((p) => p.underReview, 'A transfer nobody can confirm yet');
  const showReview = position ? Number(position.underReview) !== 0 : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="What TuTak owes you, where that money currently is, and every transfer against it."
      />

      {positionState === 'error' ? (
        <LoadError
          title="Your balance could not be loaded"
          onRetry={() => void positionQuery.refetch()}
          busy={positionQuery.isFetching}
        />
      ) : null}
      {positionState === 'stale' ? (
        <StaleNotice
          asOf={positionQuery.dataUpdatedAt}
          what="your balance"
          onRetry={() => void positionQuery.refetch()}
          busy={positionQuery.isFetching}
        />
      ) : null}

      {/*
        The position in words before it is a number.
        Three states, named: TuTak owes you, you owe TuTak, or nothing is
        outstanding either way. A partner should be able to answer "do I
        have money coming" from one line, without reading a sign off a
        figure and working out which direction it points.
      */}
      {positionState !== 'loading' && positionState !== 'error' && position ? (
        <div
          className="rounded-lg border border-subtle p-4"
          data-testid="position-headline"
          aria-live="polite"
        >
          <p className="text-[15px] font-semibold text-ink">
            {owedToYou
              ? 'TuTak owes you'
              : youOwe
                ? 'You owe TuTak'
                : 'You and TuTak are square'}
          </p>
          <p className="text-[13px] text-muted">
            {owedToYou
              ? 'Your balance is in your favour. What is below says where that money currently stands.'
              : youOwe
                ? 'Your balance is against you — refunds after a payout and your contributions add up to more than TuTak owes for. You settle this by transferring it; TuTak records the transfer.'
                : 'Nothing is outstanding in either direction right now.'}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label={youOwe ? 'You owe TuTak' : settledUp ? 'Nothing outstanding' : 'TuTak owes you in total'}
          value={totalTile.value}
          tone={owedToYou ? 'available' : youOwe ? 'reserved' : 'default'}
          hint={totalTile.hint}
        />
        <StatTile label="Not yet in a settlement" value={unsettledTile.value} hint={unsettledTile.hint} />
        <StatTile
          label="In settlements not yet paid"
          value={openTile.value}
          tone={position && Number(position.inOpenSettlements) > 0 ? 'pending' : 'default'}
          hint={openTile.hint}
        />
        <StatTile label="Paid out so far" value={paidTile.value} hint={paidTile.hint} />
        {showReview ? (
          <StatTile label="Transfers under review" value={reviewTile.value} tone="reserved" hint={reviewTile.hint} />
        ) : null}
      </div>

      {/*
        Where the money in the sales came from (brief §29). Cash and card the
        customer handed over at the till are the business's own and never
        TuTak's; the balance and bonus components are what TuTak owes for;
        the contribution reduces it. None of these is a second arithmetic of
        the total above — they are what the total is made of.
      */}
      {position && positionState !== 'error' ? (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-ink">Where your sales were paid from</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sales total" value={money(position.funding.salesGross)} hint="All confirmed sales" />
            <StatTile
              label="Received at your till"
              value={money(position.funding.receivedDirectly)}
              hint="Cash and your own card terminal. Yours already — not part of what TuTak owes"
            />
            {Number(position.funding.receivedViaProvider) > 0 ? (
              <StatTile
                label="Collected by the payment provider"
                value={money(position.funding.receivedViaProvider)}
                tone="available"
                hint="Paid inside TuTak. Not in your till — TuTak settles it to you"
              />
            ) : null}
            <StatTile
              label="Paid from TuTak balances"
              value={money(position.funding.fundedByPrepaid)}
              tone={Number(position.funding.fundedByPrepaid) > 0 ? 'available' : 'default'}
              hint="Customers' stored money. TuTak owes you this"
            />
            <StatTile
              label="Paid with bonus"
              value={money(position.funding.fundedByBonus)}
              tone={Number(position.funding.fundedByBonus) > 0 ? 'available' : 'default'}
              hint="Compensated by TuTak"
            />
            <StatTile
              label="Your contribution"
              value={money(position.funding.contribution)}
              tone={Number(position.funding.contribution) > 0 ? 'reserved' : 'default'}
              hint="Under your terms. Reduces what TuTak owes you"
            />
            <StatTile label="Refunded" value={money(position.funding.refundedGross)} hint="Merchandise value returned" />
            {Number(position.funding.owedToTuTak) > 0 ? (
              <StatTile
                label="You owe TuTak"
                value={money(position.funding.owedToTuTak)}
                tone="reserved"
                hint="Settled by a transfer you make; TuTak records it"
              />
            ) : null}
            {Number(position.funding.collectionsConfirmed) > 0 ? (
              <StatTile
                label="Transfers to TuTak confirmed"
                value={money(position.funding.collectionsConfirmed)}
                hint="Both sides have confirmed these"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {position && positionState !== 'error' ? (
        <p className="text-[12px] text-faint">
          Total = not yet in a settlement + in settlements not yet paid
          {showReview ? ' + under review' : ''}. A settlement being prepared does not mean you have been
          paid: only &ldquo;Paid&rdquo; below moves money.
        </p>
      ) : null}

      {/*
        Posting kinds nobody has classified. Surfaced rather than dropped:
        an unclassified posting on this partner's account is money whose side
        nobody has decided, and hiding it would make the figures above
        quietly incomplete.
      */}
      {position?.unrecognised?.length ? (
        <p className="text-[13px] text-faint">
          Some activity is not yet classified and is excluded from the figures above:{' '}
          {position.unrecognised.join(', ')}. TuTak has been notified.
        </p>
      ) : null}

      {statementsState === 'loading' ? (
        <LoadingNotice label="Loading your settlements…" />
      ) : statementsState === 'error' ? (
        <LoadError
          title="Your settlements could not be loaded"
          onRetry={() => void statementsQuery.refetch()}
          busy={statementsQuery.isFetching}
        />
      ) : statements!.length === 0 ? (
        <EmptyState
          title="No settlements yet"
          message="Nothing has been drafted. What you have earned so far is shown above."
        />
      ) : (
        <div>
          {statementsState === 'stale' ? (
            <StaleNotice
              asOf={statementsQuery.dataUpdatedAt}
              what="your settlements"
              onRetry={() => void statementsQuery.refetch()}
              busy={statementsQuery.isFetching}
            />
          ) : null}
          <Table>
            <thead>
              <Tr>
                <Th>Period</Th>
                <Th>Net</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th>Paid</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {statements!.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    {day(s.periodStart)} — {day(s.periodEnd)}
                  </Td>
                  <Td>{money(s.netPayableAmount)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>
                      {STATUS_TEXT[s.status] ?? s.status}
                    </Badge>
                  </Td>
                  <Td>{s.bankTransferReference ?? '—'}</Td>
                  <Td>{s.paidAt ? day(s.paidAt) : '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setOpenStatement(openStatement === s.id ? null : s.id)}
                      >
                        {openStatement === s.id ? 'Hide detail' : 'What is this made of?'}
                      </Button>
                      {/*
                        Only once a transfer has been claimed to have gone out.
                        There is nothing to dispute about a settlement still being
                        assembled, and offering the control anyway would invite a
                        complaint the server would only refuse.
                      */}
                      {s.status === 'PAYMENT_PENDING' || s.status === 'PAID' ? (
                        <Button variant="secondary" onClick={() => setReporting(s)}>
                          Report a problem
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {openStatement ? (
        <div className="space-y-2 rounded-lg border border-subtle p-4">
          <h2 className="text-[14px] font-medium">What this settlement is made of</h2>
          {statementState === 'loading' ? (
            <LoadingNotice />
          ) : statementState === 'error' ? (
            <LoadError
              title="The itemisation could not be loaded"
              onRetry={() => void statementQuery.refetch()}
              busy={statementQuery.isFetching}
            />
          ) : statement && statement.entries.length > 0 ? (
            <>
              {statementState === 'stale' ? (
                <StaleNotice
                  asOf={statementQuery.dataUpdatedAt}
                  what="this itemisation"
                  onRetry={() => void statementQuery.refetch()}
                  busy={statementQuery.isFetching}
                />
              ) : null}
              <Table>
                <thead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Branch</Th>
                    <Th>What</Th>
                    <Th>Amount</Th>
                  </Tr>
                </thead>
                <tbody>
                  {statement.entries.map((e) => (
                    <Tr key={e.id}>
                      <Td>{day(e.occurredAt)}</Td>
                      {/* Which shop the sale came from. A dash on the lines
                          that are not sales — a payout, a collection, carried
                          debt — because those have no branch to name. */}
                      <Td>
                        {e.branch ? (
                          <>
                            <div>{e.branch.name}</div>
                            <div className="text-[12px] text-muted">{e.branch.address}</div>
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </Td>
                      <Td>
                        <div>{entryKindText(e.kind)}</div>
                        {/*
                          The posting kind as stored, kept beside the plain
                          words: a partner querying a line needs to quote
                          something TuTak can look up.
                        */}
                        <div className="font-mono text-[11px] text-faint">
                          <span>{e.kind}</span> · {e.sourceType} {e.sourceId.slice(-8)}
                        </div>
                      </Td>
                      <Td>
                        {e.direction === 'DEBIT' ? '−' : ''}
                        {money(e.amount)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : (
            <p className="text-[12px] text-faint">
              This settlement has no itemised lines recorded.
            </p>
          )}
        </div>
      ) : null}

      {/* Where every figure above came from, line by line. */}
      <ActivityFeed partnerId={partnerId} />

      {reporting ? (
        <Surfaceless>
          <label htmlFor="settlement-problem" className="text-[13px] font-medium">
            What is wrong with this transfer?
          </label>
          <textarea
            id="settlement-problem"
            className="w-full rounded-md border border-subtle p-2 text-[13px]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-[12px] text-faint">
            This tells TuTak to look. It does not record whether the money
            arrived — two people at TuTak decide that, and neither of them is
            you.
          </p>
          <div className="flex gap-2">
            <Button
              // Three characters is the server's own minimum; matching it here
              // means the partner is told before the request rather than by it.
              disabled={reason.trim().length < 3 || report.isPending}
              onClick={() => report.mutate({ id: reporting.id, reason: reason.trim() })}
            >
              Send
            </Button>
            <Button variant="secondary" onClick={() => setReporting(null)}>
              Cancel
            </Button>
          </div>
          {report.isError ? (
            <p className="text-[12px] text-danger">That could not be sent. Please try again.</p>
          ) : null}
        </Surfaceless>
      ) : null}
    </div>
  );
}

/** A plain panel — the design package's Surface is card chrome this does not want. */
function Surfaceless({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 rounded-lg border border-subtle p-4">{children}</div>;
}
