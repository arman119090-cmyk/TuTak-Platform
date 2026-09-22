'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  ContributionRuleKind,
  PaymentRoute,
  PurchaseIntentDto,
  PurchaseIntentStatus,
  type ApprovePurchaseIntentRequestDto,
} from '@tutak/shared-types';
import { unitLabelKey } from '@tutak/i18n';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { describeApiFailure, type ApiFailure } from '@/lib/apiError';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((+new Date(expiresAt) - now) / 1000));
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return (
    <Badge tone={secondsLeft < 60 ? 'danger' : 'pending'}>
      {m}:{String(s).padStart(2, '0')}
    </Badge>
  );
}

/** True once the client clock alone is enough to know the window is over — used to disable Confirm/Reject before the server agrees. */
function useExpired(expiresAt: string): boolean {
  const [expired, setExpired] = useState(() => +new Date(expiresAt) <= Date.now());
  useEffect(() => {
    if (expired) return;
    const id = setInterval(() => {
      if (+new Date(expiresAt) <= Date.now()) setExpired(true);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, expired]);
  return expired;
}

/** A purchase id and what the cashier read back about it. */
interface ConfirmArgs {
  id: string;
  dto: ApprovePurchaseIntentRequestDto;
}

/**
 * Whether the platform's share of this purchase is calculated from the
 * quantity, which is what decides whether the cashier has to confirm it.
 *
 * `FIXED_PER_UNIT` and `HYBRID` price the sale as `quantity × margin`, so the
 * quantity is not a line on the receipt — it is the price. A confirm button
 * next to a number nobody read is not approval of that number.
 */
function isPricedPerUnit(intent: PurchaseIntentDto): boolean {
  return (
    intent.contributionRuleKind === ContributionRuleKind.FIXED_PER_UNIT ||
    intent.contributionRuleKind === ContributionRuleKind.HYBRID
  );
}

/**
 * The line item, for a cashier to check against the pump.
 *
 * Shown before approval and frozen after it. The server compares whatever is
 * typed back against the stored snapshot and refuses a mismatch — this panel
 * is what makes that check meaningful rather than a formality, because it
 * shows the figures being agreed to.
 */
function LineItem({
  intent,
  echo,
  setEcho,
  editable,
}: {
  intent: PurchaseIntentDto;
  echo: { quantity: string; unitPrice: string };
  setEcho: (next: { quantity: string; unitPrice: string }) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  // The label comes from the shared translation layer rather than being
  // written here, so the financial enum stays the only identifier and the
  // unit reads in the panel's language like everything around it.
  const unit = intent.quantityUnit ? t(unitLabelKey(intent.quantityUnit)) : '';
  const product = Number(echo.quantity || 0) * Number(echo.unitPrice || 0);
  const matches = product === Number(intent.grossAmount);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-muted p-3">
      <div className="text-[12px] font-medium text-faint">
        {t('partnerPanel.purchaseIntents.perUnitHint', {
          unit: unit || t('partnerPanel.purchaseIntents.unitFallback'),
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Input
          aria-label={t('partnerPanel.purchaseIntents.quantityLabel')}
          disabled={!editable}
          value={echo.quantity}
          onChange={(e) => setEcho({ ...echo, quantity: e.target.value })}
          className="h-8 w-24 text-right tabular"
        />
        <span className="text-faint">{unit}</span>
        <span className="text-faint">×</span>
        <Input
          aria-label={t('partnerPanel.purchaseIntents.unitPriceLabel')}
          disabled={!editable}
          value={echo.unitPrice}
          onChange={(e) => setEcho({ ...echo, unitPrice: e.target.value })}
          className="h-8 w-24 text-right tabular"
        />
        <span className="text-faint">֏ =</span>
        {/*
          Computed in the browser only so the cashier can see the arithmetic
          close before they commit. The server checks it again against its own
          snapshot and is the authority; this is a mirror, never a source.
        */}
        <span
          className={
            matches
              ? 'tabular font-semibold text-ink'
              : 'tabular font-semibold text-danger-text'
          }
        >
          {num(product)} ֏
        </span>
        {!matches && (
          <span className="text-[12px] text-danger-text">
            {t('partnerPanel.purchaseIntents.mismatch', { amount: num(intent.grossAmount) })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * What a provider-routed purchase looks like once staff have approved it.
 *
 * Deliberately has no button. The cashier's part is over: they agreed what is
 * being sold, and whether the customer's money actually arrived is something
 * only the provider's verified callback can establish. A "mark as paid"
 * control here would credit the partner on a guess made by somebody who
 * cannot see the provider's ledger.
 */
function AwaitingProvider() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge tone="pending">{t('partnerPanel.purchaseIntents.awaitingTitle')}</Badge>
      <span className="max-w-[16rem] text-right text-[11px] leading-tight text-faint">
        {t('partnerPanel.purchaseIntents.awaitingNote')}
      </span>
    </div>
  );
}

/**
 * What the cashier is told when an action did not go through.
 *
 * The distinction is the whole message. A `state` refusal means the server
 * looked and the purchase had already moved on — expired, confirmed by a
 * colleague, cancelled by the customer — and the queue is re-read so the row
 * shows what actually happened. A `network` failure means nothing is known:
 * the tap may or may not have landed, so the form and its reason are kept
 * and the person is told to look before tapping again.
 */
function ActionFailure({ failure }: { failure: ApiFailure }) {
  const { t } = useTranslation();
  if (failure.kind === 'state') {
    return (
      <p role="alert" className="max-w-[20rem] text-right text-[12px] text-pending-text">
        {t('partnerPanel.purchaseIntents.failureState', { message: failure.message })}
      </p>
    );
  }
  if (failure.kind === 'network') {
    return (
      <p role="alert" className="max-w-[20rem] text-right text-[12px] text-danger-text">
        {t('partnerPanel.purchaseIntents.failureNetwork')}
      </p>
    );
  }
  return (
    <p role="alert" className="max-w-[20rem] text-right text-[12px] text-danger-text">
      {t('partnerPanel.purchaseIntents.failureOther', { message: failure.message })}
    </p>
  );
}

function IntentRow({
  intent,
  confirm,
  approve,
  reject,
  rejecting,
  reasonCode,
  setReasonCode,
  onStartReject,
  onCancelReject,
  failure,
}: {
  intent: PurchaseIntentDto;
  confirm: UseMutationResult<PurchaseIntentDto, unknown, ConfirmArgs>;
  approve: UseMutationResult<PurchaseIntentDto, unknown, ConfirmArgs>;
  reject: UseMutationResult<PurchaseIntentDto, unknown, string>;
  rejecting: boolean;
  reasonCode: string;
  setReasonCode: (v: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  /** The last failed action on this row, if any. */
  failure: ApiFailure | null;
}) {
  const { t } = useTranslation();
  // The 3-minute window is a server rule (reject() now enforces it the
  // same way confirm() always has — see purchase-intents.service.ts), but
  // a cashier should never be able to *tap* Confirm/Reject on a row the
  // client already knows is past its deadline: disabling here avoids a
  // request that can only ever come back as "this intent has expired."
  const expired = useExpired(intent.expiresAt);
  const perUnit = isPricedPerUnit(intent);
  const viaProvider = intent.paymentRoute === PaymentRoute.TUTAK_PSP;
  const approved = intent.merchantApprovedAt !== null;

  /*
   * Seeded from the purchase, not blank.
   *
   * The cashier is checking a figure against the pump, not transcribing one.
   * A blank box would make them read the number off the customer's phone and
   * type it back, which proves nothing — the value of this step is that a
   * wrong figure is visible next to a right one.
   */
  const [echo, setEcho] = useState({
    quantity: intent.quantity ?? '',
    unitPrice: intent.unitPrice ?? '',
  });

  const lineItem: ApprovePurchaseIntentRequestDto = perUnit
    ? {
        quantity: echo.quantity,
        quantityUnit: intent.quantityUnit ?? undefined,
        unitPrice: echo.unitPrice,
      }
    : {};

  return (
    <Tr>
      <Td className="font-mono text-[16px] font-semibold tracking-[0.2em] text-ink">
        {intent.confirmationCode ?? '—'}
      </Td>
      <Td className="font-mono text-[12px] text-faint">{intent.id.slice(-8).toUpperCase()}</Td>
      <Td align="right" className="tabular text-faint">
        {num(intent.grossAmount)} ֏
      </Td>
      <Td align="right" className="tabular">
        {Number(intent.bonusAmountRequested) > 0 || Number(intent.prepaidAmountApplied) > 0 ? (
          <div className="flex flex-col items-end">
            {Number(intent.bonusAmountRequested) > 0 ? (
              <span className="text-reserved-text">−{num(intent.bonusAmountRequested)}</span>
            ) : null}
            {/* The customer's own stored money — TuTak's to settle, not the till's to take. */}
            {Number(intent.prepaidAmountApplied) > 0 ? (
              <span
                className="text-reserved-text"
                title={t('partnerPanel.purchaseIntents.balanceTitle')}
              >
                −{num(intent.prepaidAmountApplied)}{' '}
                <span className="text-[11px] text-faint">
                  {t('partnerPanel.purchaseIntents.balance')}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-faint">—</span>
        )}
      </Td>
      {/*
        The amount to actually take from the customer, stated rather than
        implied.

        This column did not exist: the cashier was shown the gross and the
        bonus in separate columns and left to subtract. On a 15,000 purchase
        with 1,000 in points that is a 1,000 error waiting for a queue and a
        distraction, and it is the customer who pays it. The server has
        already computed the figure — `ordinaryPaymentRemainder` — so nothing
        here is derived in the browser either.

        Deliberately the loudest number in the row; the gross is now muted,
        because it is context, not an instruction.
      */}
      <Td align="right" className="tabular text-[16px] font-semibold text-ink">
        {num(intent.ordinaryPaymentRemainder)} ֏
        {/*
          A zero is said in words (§19, §28). Nothing to take from the
          customer is not "paid": TuTak covers it only once this row is
          confirmed, and the wording must not get ahead of that.
        */}
        {Number(intent.ordinaryPaymentRemainder) === 0 && !viaProvider ? (
          <div className="text-[11px] font-normal text-faint">
            {t('partnerPanel.purchaseIntents.collectZero')}
          </div>
        ) : null}
      </Td>
      <Td>
        <Countdown expiresAt={intent.expiresAt} />
      </Td>
      <Td>
        {viaProvider ? (
          <Badge tone="pending">{t('partnerPanel.purchaseIntents.howInTutak')}</Badge>
        ) : (
          <Badge tone="neutral">{t('partnerPanel.purchaseIntents.howAtTill')}</Badge>
        )}
      </Td>
      <Td align="right">
        {/*
          A provider-routed purchase that staff have already approved has no
          action left for the cashier. That is the whole point of the split:
          approval authorises the bill, and whether the money arrived is
          established by the provider's verified callback and by nothing a
          person at the till can see.
        */}
        {/*
          Rendered in every state, not only while it is editable.

          A cashier waiting on a provider payment should still be able to see
          what was agreed — the frozen figures are the answer to "what am I
          waiting for", and hiding them would make the wait opaque.
        */}
        {perUnit && (
          <div className="mb-2 flex justify-end">
            <LineItem intent={intent} echo={echo} setEcho={setEcho} editable={!approved} />
          </div>
        )}
        {viaProvider && approved ? (
          <AwaitingProvider />
        ) : expired ? (
          <span className="text-[12px] text-faint">
            {t('partnerPanel.purchaseIntents.expiring')}
          </span>
        ) : rejecting ? (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
              <Input
                autoFocus
                placeholder={t('partnerPanel.purchaseIntents.reasonPlaceholder')}
                aria-label={t('partnerPanel.purchaseIntents.reasonLabel')}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="h-8 w-40 text-[13px]"
              />
              <Button
                size="sm"
                variant="destructive"
                loading={reject.isPending}
                disabled={!reasonCode}
                onClick={() => reject.mutate(intent.id)}
              >
                {t('partnerPanel.purchaseIntents.confirmDecline')}
              </Button>
              <Button size="sm" variant="secondary" onClick={onCancelReject}>
                {t('partnerPanel.purchaseIntents.cancel')}
              </Button>
            </div>
            {failure ? <ActionFailure failure={failure} /> : null}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onStartReject}>
                {t('partnerPanel.purchaseIntents.reject')}
              </Button>
              {viaProvider ? (
                <Button
                  size="sm"
                  loading={approve.isPending}
                  onClick={() => approve.mutate({ id: intent.id, dto: lineItem })}
                >
                  {t('partnerPanel.purchaseIntents.approveForPayment')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={confirm.isPending}
                  onClick={() => confirm.mutate({ id: intent.id, dto: lineItem })}
                >
                  {t('partnerPanel.purchaseIntents.confirm')}
                </Button>
              )}
            </div>
            {failure ? <ActionFailure failure={failure} /> : null}
          </div>
        )}
      </Td>
    </Tr>
  );
}

/**
 * Spec §7 steps 9-11 / §25-26: the cashier's queue. Amount, bonus, and the
 * negotiated rate were all fixed by the customer at creation and are shown
 * read-only here on purpose — CONFIRM/REJECT is the only action a cashier
 * has, matching PurchaseIntentsController's actual surface
 * (`RequirePermissions(PURCHASE_INTENT_CONFIRM)`, no amount-editing
 * endpoint exists).
 *
 * ## An empty queue and an unreachable one are different screens
 *
 * The list used to be `intents ?? []`, which drew "No pending requests" while
 * the first request was in flight, when the server refused, and when the
 * five-second poll had been failing for ten minutes. A cashier reading that
 * sends the customer away. Now: loading says loading, a failure with nothing
 * received says so with a retry, and a queue that arrived once and then
 * stopped refreshing stays on screen labelled with the time it was true.
 * Nothing on this page ever suggests creating a new purchase to get past a
 * connection problem — the customer's purchase is still live on the server.
 */
export default function PurchaseIntentsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  /** The last failed action, kept on the row it belongs to. */
  const [failure, setFailure] = useState<{ id: string; failure: ApiFailure } | null>(null);

  const queue = useQuery({
    queryKey: ['purchase-intents', partnerId],
    queryFn: () => purchaseIntentApi.list(partnerId!, PurchaseIntentStatus.AWAITING_CONFIRMATION),
    enabled: !!partnerId,
    // A customer at the till is watching a 3-minute countdown — the queue
    // has to surface a new intent within a few seconds of it being created,
    // not on the next manual refresh.
    refetchInterval: 5000,
  });
  const queueState = dataStateOf(queue);
  const invalidateQueue = () =>
    queryClient.invalidateQueries({ queryKey: ['purchase-intents', partnerId] });

  /*
   * One failure handler for every action.
   *
   * The server re-reads the purchase on confirm, approve and reject (status,
   * expiry, branch) before doing anything, so a refusal here is the server
   * reporting a fact — and the queue is re-read so the row shows it. A
   * failure with no answer at all keeps the row and whatever was typed, and
   * still re-reads the queue: the request may have landed.
   */
  const onActionError = (id: string) => (error: unknown) => {
    setFailure({ id, failure: describeApiFailure(error) });
    void invalidateQueue();
  };

  const confirm = useMutation({
    mutationFn: ({ id, dto }: ConfirmArgs) => purchaseIntentApi.confirm(id, dto),
    onMutate: () => setFailure(null),
    onSuccess: () => void invalidateQueue(),
    onError: (error, { id }) => onActionError(id)(error),
  });

  /*
   * Approving a provider-routed purchase keeps it in this queue rather than
   * clearing it, because it is not finished: it is waiting for the customer
   * to pay. The row changes to a waiting state with no button, so the cashier
   * can see it is live without being offered a way to close it.
   */
  const approve = useMutation({
    mutationFn: ({ id, dto }: ConfirmArgs) => purchaseIntentApi.approveForPayment(id, dto),
    onMutate: () => setFailure(null),
    onSuccess: () => void invalidateQueue(),
    onError: (error, { id }) => onActionError(id)(error),
  });

  const reject = useMutation({
    mutationFn: (id: string) => purchaseIntentApi.reject(id, { reasonCode: reasonCode || 'declined' }),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      setRejectingId(null);
      setReasonCode('');
      void invalidateQueue();
    },
    /*
     * The reason is kept unless the server says the purchase is gone.
     *
     * This used to clear the form on every error. A cashier who typed why
     * they were declining, lost the network for a second and found the box
     * empty and closed had to type it again — and could not tell whether the
     * decline had gone through. Now a `state` refusal (expired, already
     * confirmed, cancelled) closes the form because there is nothing left to
     * decline, and every other failure keeps it open with the reason intact.
     */
    onError: (error, id) => {
      const described = describeApiFailure(error);
      setFailure({ id, failure: described });
      if (described.kind === 'state') {
        setRejectingId(null);
        setReasonCode('');
      }
      void invalidateQueue();
    },
  });

  // Matching by the code the customer reads out, without hunting down a
  // long queue by eye.
  //
  // Filtered here rather than through GET /purchase-intents/by-code on
  // purpose: this list is already exactly the set of awaiting purchases
  // this cashier is allowed to see (the server scopes it by partner and by
  // branch), so narrowing it locally is instant and cannot show anything
  // the queue would not. The endpoint stays the way in for anything that
  // does not already hold the queue.
  const [codeFilter, setCodeFilter] = useState('');
  const digitsOnly = codeFilter.replace(/\D/g, '').slice(0, 4);
  const all = queue.data ?? [];
  const items = digitsOnly
    ? all.filter((intent) => (intent.confirmationCode ?? '').startsWith(digitsOnly))
    : all;

  return (
    <>
      <PageHeader
        title={t('partnerPanel.purchaseIntents.title')}
        description={t('partnerPanel.purchaseIntents.description')}
      />

      {queueState === 'loading' ? (
        <LoadingNotice label={t('partnerPanel.purchaseIntents.loading')} />
      ) : queueState === 'error' ? (
        <LoadError
          title={t('partnerPanel.purchaseIntents.loadError')}
          onRetry={() => void queue.refetch()}
          busy={queue.isFetching}
        />
      ) : (
        <>
          {queueState === 'stale' ? (
            <StaleNotice
              asOf={queue.dataUpdatedAt}
              what={t('partnerPanel.purchaseIntents.staleWhat')}
              onRetry={() => void queue.refetch()}
              busy={queue.isFetching}
            />
          ) : null}

          {all.length > 0 ? (
            <div className="mb-4 max-w-[220px]">
              <Input
                inputMode="numeric"
                maxLength={4}
                placeholder={t('partnerPanel.purchaseIntents.filterPlaceholder')}
                aria-label={t('partnerPanel.purchaseIntents.filterLabel')}
                value={digitsOnly}
                onChange={(event) => setCodeFilter(event.target.value)}
              />
            </div>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              title={t(
                digitsOnly
                  ? 'partnerPanel.purchaseIntents.emptyFilteredTitle'
                  : 'partnerPanel.purchaseIntents.emptyTitle',
              )}
              message={t(
                digitsOnly
                  ? 'partnerPanel.purchaseIntents.emptyFilteredMessage'
                  : 'partnerPanel.purchaseIntents.emptyMessage',
              )}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  {/*
                    The code first, and the id after it: a cashier matches the
                    four digits the customer reads out, while the id is what
                    support asks for later. A row from before codes existed
                    shows a dash and is matched by its id as before.
                  */}
                  <Th>{t('partnerPanel.purchaseIntents.colCode')}</Th>
                  <Th>{t('partnerPanel.purchaseIntents.colId')}</Th>
                  <Th align="right">{t('partnerPanel.purchaseIntents.colPurchase')}</Th>
                  <Th align="right">{t('partnerPanel.purchaseIntents.colBonus')}</Th>
                  <Th align="right">{t('partnerPanel.purchaseIntents.colCollect')}</Th>
                  <Th>{t('partnerPanel.purchaseIntents.colHow')}</Th>
                  <Th>{t('partnerPanel.purchaseIntents.colExpires')}</Th>
                  <Th align="right">{t('partnerPanel.purchaseIntents.colAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((intent) => (
                  <IntentRow
                    key={intent.id}
                    intent={intent}
                    confirm={confirm}
                    approve={approve}
                    reject={reject}
                    rejecting={rejectingId === intent.id}
                    reasonCode={reasonCode}
                    setReasonCode={setReasonCode}
                    onStartReject={() => {
                      setFailure(null);
                      setRejectingId(intent.id);
                    }}
                    onCancelReject={() => {
                      setRejectingId(null);
                      setReasonCode('');
                    }}
                    failure={failure?.id === intent.id ? failure.failure : null}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
