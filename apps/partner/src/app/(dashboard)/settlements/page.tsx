'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import { kindKey } from './ActivityFeed';
import type { PartnerSettlementDto, UnsettledPositionDto } from '@tutak/shared-types';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { ActivityFeed } from './ActivityFeed';
import { dataStateOf } from '@/lib/queryState';
import {
  AccessRefused,
  LoadError,
  LoadingNotice,
  StaleNotice,
} from '@/lib/components/DataStatus';

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

/**
 * Where a report about a missing transfer is accepted. Mirrors the server's
 * own `REPORTABLE`; a control the server would refuse teaches people the app
 * is broken.
 */
const REPORTABLE_STATUSES = new Set([
  'PAYMENT_PENDING',
  'PAID',
  'FAILED',
  'REQUIRES_RECONCILIATION',
]);

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
  const { t } = useTranslation();
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

  // A refusal on the position is a refusal on the whole screen: every
  // figure and every list below it answers the same question, so showing
  // three separate "could not load" boxes with retry buttons would be three
  // wrong descriptions of one answer.
  const refused = positionState === 'forbidden';

  if (!partnerId) {
    return (
      <EmptyState
        title={t('partnerPanel.common.noBusiness')}
        message={t('partnerPanel.common.noBusinessMessage')}
      />
    );
  }

  /** A tile's value and caption for the state its figure is in. */
  const figure = (value: (p: UnsettledPositionDto) => string, caption: string) => {
    if (positionState === 'loading') {
      return { value: '—', hint: t('partnerPanel.common.loading') };
    }
    // Anything that is not a figure in hand is a dash. `position` is only
    // safe to read in the two states that mean it arrived, and reading it
    // in any other threw — which on this screen is a blank page where a
    // balance should be.
    if (positionState !== 'fresh' && positionState !== 'stale') {
      return { value: '—', hint: t('partnerPanel.common.couldNotLoad') };
    }
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
    t(
      youOwe
        ? 'partnerPanel.settlements.totalHintYouOwe'
        : 'partnerPanel.settlements.totalHintOwed',
    ),
  );
  const unsettledTile = figure((p) => p.net, t('partnerPanel.settlements.notInSettlementHint'));
  const openTile = figure(
    (p) => p.inOpenSettlements,
    t('partnerPanel.settlements.inOpenSettlementsHint'),
  );
  const paidTile = figure((p) => p.paidTotal, t('partnerPanel.settlements.paidOutHint'));
  const reviewTile = figure((p) => p.underReview, t('partnerPanel.settlements.underReviewHint'));
  const showReview = position ? Number(position.underReview) !== 0 : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('partnerPanel.settlements.title')}
        description={t('partnerPanel.settlements.description')}
      />

      {refused ? (
        <AccessRefused
          title={t('partnerPanel.refused.title')}
          message={t('partnerPanel.refused.settlements')}
        />
      ) : null}

      {positionState === 'error' ? (
        <LoadError
          title={t('partnerPanel.settlements.balanceError')}
          onRetry={() => void positionQuery.refetch()}
          busy={positionQuery.isFetching}
        />
      ) : null}
      {positionState === 'stale' ? (
        <StaleNotice
          asOf={positionQuery.dataUpdatedAt}
          what={t('partnerPanel.stale.whatBalance')}
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
      {positionState === 'fresh' || positionState === 'stale' ? (
        <div
          className="rounded-lg border border-subtle p-4"
          data-testid="position-headline"
          aria-live="polite"
        >
          <p className="text-[15px] font-semibold text-ink">
            {t(
              owedToYou
                ? 'partnerPanel.settlements.stateOwedToYou'
                : youOwe
                  ? 'partnerPanel.settlements.stateYouOwe'
                  : 'partnerPanel.settlements.stateSquare',
            )}
          </p>
          <p className="text-[13px] text-muted">
            {t(
              owedToYou
                ? 'partnerPanel.settlements.stateOwedToYouBody'
                : youOwe
                  ? 'partnerPanel.settlements.stateYouOweBody'
                  : 'partnerPanel.settlements.stateSquareBody',
            )}
          </p>
        </div>
      ) : null}

      <div className={refused ? 'hidden' : 'grid gap-4 sm:grid-cols-2'}>
        <StatTile
          label={t(
            youOwe
              ? 'partnerPanel.settlements.stateYouOwe'
              : settledUp
                ? 'partnerPanel.settlements.totalNothing'
                : 'partnerPanel.settlements.totalOwed',
          )}
          value={totalTile.value}
          tone={owedToYou ? 'available' : youOwe ? 'reserved' : 'default'}
          hint={totalTile.hint}
        />
        <StatTile
          label={t('partnerPanel.settlements.notInSettlement')}
          value={unsettledTile.value}
          hint={unsettledTile.hint}
        />
        <StatTile
          label={t('partnerPanel.settlements.inOpenSettlements')}
          value={openTile.value}
          tone={position && Number(position.inOpenSettlements) > 0 ? 'pending' : 'default'}
          hint={openTile.hint}
        />
        <StatTile
          label={t('partnerPanel.settlements.paidOut')}
          value={paidTile.value}
          hint={paidTile.hint}
        />
        {showReview ? (
          <StatTile
            label={t('partnerPanel.settlements.underReview')}
            value={reviewTile.value}
            tone="reserved"
            hint={reviewTile.hint}
          />
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
          <h2 className="text-[15px] font-semibold text-ink">
            {t('partnerPanel.funding.heading')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('partnerPanel.funding.salesTotal')}
              value={money(position.funding.salesGross)}
              hint={t('partnerPanel.funding.salesTotalHint')}
            />
            <StatTile
              label={t('partnerPanel.funding.atTill')}
              value={money(position.funding.receivedDirectly)}
              hint={t('partnerPanel.funding.atTillHint')}
            />
            {Number(position.funding.receivedViaProvider) > 0 ? (
              <StatTile
                label={t('partnerPanel.funding.viaProvider')}
                value={money(position.funding.receivedViaProvider)}
                tone="available"
                hint={t('partnerPanel.funding.viaProviderHint')}
              />
            ) : null}
            <StatTile
              label={t('partnerPanel.funding.fromBalances')}
              value={money(position.funding.fundedByPrepaid)}
              tone={Number(position.funding.fundedByPrepaid) > 0 ? 'available' : 'default'}
              hint={t('partnerPanel.funding.fromBalancesHint')}
            />
            <StatTile
              label={t('partnerPanel.funding.withBonus')}
              value={money(position.funding.fundedByBonus)}
              tone={Number(position.funding.fundedByBonus) > 0 ? 'available' : 'default'}
              hint={t('partnerPanel.funding.withBonusHint')}
            />
            <StatTile
              label={t('partnerPanel.funding.contribution')}
              value={money(position.funding.contribution)}
              tone={Number(position.funding.contribution) > 0 ? 'reserved' : 'default'}
              hint={t('partnerPanel.funding.contributionHint')}
            />
            <StatTile
              label={t('partnerPanel.funding.refunded')}
              value={money(position.funding.refundedGross)}
              hint={t('partnerPanel.funding.refundedHint')}
            />
            {Number(position.funding.owedToTuTak) > 0 ? (
              <StatTile
                label={t('partnerPanel.funding.youOwe')}
                value={money(position.funding.owedToTuTak)}
                tone="reserved"
                hint={t('partnerPanel.funding.youOweHint')}
              />
            ) : null}
            {Number(position.funding.collectionsConfirmed) > 0 ? (
              <StatTile
                label={t('partnerPanel.funding.collections')}
                value={money(position.funding.collectionsConfirmed)}
                hint={t('partnerPanel.funding.collectionsHint')}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {position && positionState !== 'error' ? (
        <p className="text-[12px] text-faint">
          {t('partnerPanel.settlements.identity', {
            review: showReview ? t('partnerPanel.settlements.identityReview') : '',
          })}
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
          {t('partnerPanel.funding.unrecognised', { kinds: position.unrecognised.join(', ') })}
        </p>
      ) : null}

      {refused ? null : statementsState === 'loading' ? (
        <LoadingNotice label={t('partnerPanel.statement.loading')} />
      ) : statementsState === 'error' ? (
        <LoadError
          title={t('partnerPanel.statement.listError')}
          onRetry={() => void statementsQuery.refetch()}
          busy={statementsQuery.isFetching}
        />
      ) : statements!.length === 0 ? (
        <EmptyState
          title={t('partnerPanel.statement.emptyTitle')}
          message={t('partnerPanel.statement.emptyMessage')}
        />
      ) : (
        <div>
          {statementsState === 'stale' ? (
            <StaleNotice
              asOf={statementsQuery.dataUpdatedAt}
              what={t('partnerPanel.stale.whatSettlements')}
              onRetry={() => void statementsQuery.refetch()}
              busy={statementsQuery.isFetching}
            />
          ) : null}
          <Table>
            <thead>
              <Tr>
                <Th>{t('partnerPanel.statement.period')}</Th>
                <Th>{t('partnerPanel.statement.net')}</Th>
                <Th>{t('partnerPanel.statement.statusColumn')}</Th>
                <Th>{t('partnerPanel.statement.reference')}</Th>
                <Th>{t('partnerPanel.statement.paid')}</Th>
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
                      {t(`partnerPanel.status.${s.status}`, { defaultValue: s.status })}
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
                        {openStatement === s.id
                          ? t('partnerPanel.statement.hide')
                          : t('partnerPanel.statement.open')}
                      </Button>
                      {/*
                        Only once a transfer has been claimed to have gone out.
                        There is nothing to dispute about a settlement still being
                        assembled, and offering the control anyway would invite a
                        complaint the server would only refuse.

                        The four states here are exactly the server's
                        `REPORTABLE` list. `FAILED` belongs on it: a bank can
                        report a transfer as bounced and still have moved the
                        money, which is the case worth hearing about. A second
                        report while a review is open is recorded rather than
                        refused, so the control stays.
                      */}
                      {REPORTABLE_STATUSES.has(s.status) ? (
                        <Button variant="secondary" onClick={() => setReporting(s)}>
                          {t('partnerPanel.settlements.reportProblem')}
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
          <h2 className="text-[14px] font-medium">{t('partnerPanel.statement.heading')}</h2>
          {statementState === 'loading' ? (
            <LoadingNotice />
          ) : statementState === 'error' ? (
            <LoadError
              title={t('partnerPanel.statement.loadError')}
              onRetry={() => void statementQuery.refetch()}
              busy={statementQuery.isFetching}
            />
          ) : statement && statement.entries.length > 0 ? (
            <>
              {statementState === 'stale' ? (
                <StaleNotice
                  asOf={statementQuery.dataUpdatedAt}
                  what={t('partnerPanel.stale.whatItemisation')}
                  onRetry={() => void statementQuery.refetch()}
                  busy={statementQuery.isFetching}
                />
              ) : null}
              <Table>
                <thead>
                  <Tr>
                    <Th>{t('partnerPanel.statement.when')}</Th>
                    <Th>{t('partnerPanel.statement.branch')}</Th>
                    <Th>{t('partnerPanel.statement.what')}</Th>
                    <Th>{t('partnerPanel.statement.amount')}</Th>
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
                        <div>{t(kindKey(e.kind))}</div>
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
            <p className="text-[12px] text-faint">{t('partnerPanel.statement.noLines')}</p>
          )}
        </div>
      ) : null}

      {/* Where every figure above came from, line by line. */}
      {refused ? null : <ActivityFeed partnerId={partnerId} />}

      {reporting ? (
        <Surfaceless>
          <label htmlFor="settlement-problem" className="text-[13px] font-medium">
            {t('partnerPanel.settlements.reportQuestion')}
          </label>
          <textarea
            id="settlement-problem"
            className="w-full rounded-md border border-subtle p-2 text-[13px]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-[12px] text-faint">{t('partnerPanel.settlements.reportNote')}</p>
          <div className="flex gap-2">
            <Button
              // Three characters is the server's own minimum; matching it here
              // means the partner is told before the request rather than by it.
              disabled={reason.trim().length < 3 || report.isPending}
              onClick={() => report.mutate({ id: reporting.id, reason: reason.trim() })}
            >
              {t('partnerPanel.common.send')}
            </Button>
            <Button variant="secondary" onClick={() => setReporting(null)}>
              {t('partnerPanel.common.cancel')}
            </Button>
          </div>
          {report.isError ? (
            <p className="text-[12px] text-danger">{t('partnerPanel.settlements.reportFailed')}</p>
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
