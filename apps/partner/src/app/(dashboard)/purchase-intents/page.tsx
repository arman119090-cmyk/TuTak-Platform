'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  ContributionRuleKind,
  PaymentRoute,
  PurchaseIntentDto,
  PurchaseIntentStatus,
  type ApprovePurchaseIntentRequestDto,
} from '@tutak/shared-types';
import { unitLabel } from '@tutak/i18n';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';

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
  // English, because this dashboard is English-only. The label still comes
  // from the shared translation layer rather than being written here, so the
  // financial enum stays the only identifier and adding a locale later is a
  // change in one place.
  const unit = intent.quantityUnit ? unitLabel(intent.quantityUnit, 'en') : '';
  const product = Number(echo.quantity || 0) * Number(echo.unitPrice || 0);
  const matches = product === Number(intent.grossAmount);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-muted p-3">
      <div className="text-[12px] font-medium text-faint">
        This business is paid per {unit || 'unit'}. Check what the pump says.
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Input
          aria-label="Quantity"
          disabled={!editable}
          value={echo.quantity}
          onChange={(e) => setEcho({ ...echo, quantity: e.target.value })}
          className="h-8 w-24 text-right tabular"
        />
        <span className="text-faint">{unit}</span>
        <span className="text-faint">×</span>
        <Input
          aria-label="Unit price"
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
            does not match the purchase ({num(intent.grossAmount)} ֏)
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
function AwaitingProvider({ intent }: { intent: PurchaseIntentDto }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge tone="pending">Waiting for payment</Badge>
      <span className="max-w-[16rem] text-right text-[11px] leading-tight text-faint">
        The customer is paying in TuTak. This will complete on its own —
        do not take cash for it.
      </span>
    </div>
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
}) {
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
        {Number(intent.bonusAmountRequested) > 0 ? (
          <span className="text-reserved-text">−{num(intent.bonusAmountRequested)}</span>
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
      </Td>
      <Td>
        <Countdown expiresAt={intent.expiresAt} />
      </Td>
      <Td>
        {viaProvider ? (
          <Badge tone="pending">In TuTak</Badge>
        ) : (
          <Badge tone="neutral">At the till</Badge>
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
          <AwaitingProvider intent={intent} />
        ) : expired ? (
          <span className="text-[12px] text-faint">Expiring…</span>
        ) : rejecting ? (
          <div className="flex items-center justify-end gap-2">
            <Input
              autoFocus
              placeholder="Reason"
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
              Confirm decline
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancelReject}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onStartReject}>
                Reject
              </Button>
              {viaProvider ? (
                <Button
                  size="sm"
                  loading={approve.isPending}
                  onClick={() => approve.mutate({ id: intent.id, dto: lineItem })}
                >
                  Approve for payment
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={confirm.isPending}
                  onClick={() => confirm.mutate({ id: intent.id, dto: lineItem })}
                >
                  Confirm
                </Button>
              )}
            </div>
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
 */
export default function PurchaseIntentsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');

  const { data: intents } = useQuery({
    queryKey: ['purchase-intents', partnerId],
    queryFn: () => purchaseIntentApi.list(partnerId!, PurchaseIntentStatus.AWAITING_CONFIRMATION),
    enabled: !!partnerId,
    // A customer at the till is watching a 3-minute countdown — the queue
    // has to surface a new intent within a few seconds of it being created,
    // not on the next manual refresh.
    refetchInterval: 5000,
  });

  const confirm = useMutation({
    mutationFn: ({ id, dto }: ConfirmArgs) => purchaseIntentApi.confirm(id, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-intents', partnerId] }),
  });

  /*
   * Approving a provider-routed purchase keeps it in this queue rather than
   * clearing it, because it is not finished: it is waiting for the customer
   * to pay. The row changes to a waiting state with no button, so the cashier
   * can see it is live without being offered a way to close it.
   */
  const approve = useMutation({
    mutationFn: ({ id, dto }: ConfirmArgs) => purchaseIntentApi.approveForPayment(id, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-intents', partnerId] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => purchaseIntentApi.reject(id, { reasonCode: reasonCode || 'declined' }),
    onSuccess: () => {
      setRejectingId(null);
      setReasonCode('');
      queryClient.invalidateQueries({ queryKey: ['purchase-intents', partnerId] });
    },
    // A reject can now fail because the 3-minute window closed underneath
    // it (the server expires the row instead of rejecting it past
    // deadline) — the row still needs to leave this queue, it just didn't
    // leave it the way this tap intended.
    onError: () => {
      setRejectingId(null);
      setReasonCode('');
      queryClient.invalidateQueries({ queryKey: ['purchase-intents', partnerId] });
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
  const all = intents ?? [];
  const items = digitsOnly
    ? all.filter((intent) => (intent.confirmationCode ?? '').startsWith(digitsOnly))
    : all;

  return (
    <>
      <PageHeader
        title="Purchase requests"
        description="Customers who scanned your code and entered an amount. Confirm a till sale to complete it. A purchase being paid in TuTak is approved here and then completes on its own — never take cash for one."
      />

      {all.length > 0 ? (
        <div className="mb-4 max-w-[220px]">
          <Input
            inputMode="numeric"
            maxLength={4}
            placeholder="Code, e.g. 0042"
            aria-label="Find a request by the code the customer read out"
            value={digitsOnly}
            onChange={(event) => setCodeFilter(event.target.value)}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={digitsOnly ? 'No request with that code' : 'No pending requests'}
          message={
            digitsOnly
              ? 'Check the digits with the customer. A request also leaves this queue on its own after 3 minutes.'
              : 'A new request appears here the moment a customer submits one, and expires on its own after 3 minutes if nobody acts.'
          }
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
              <Th>Code</Th>
              <Th>ID</Th>
              <Th align="right">Purchase</Th>
              <Th align="right">Bonus requested</Th>
              <Th align="right">To collect</Th>
              <Th>How</Th>
              <Th>Expires in</Th>
              <Th align="right">Action</Th>
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
                onStartReject={() => setRejectingId(intent.id)}
                onCancelReject={() => {
                  setRejectingId(null);
                  setReasonCode('');
                }}
              />
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
