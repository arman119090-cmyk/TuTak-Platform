'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { PurchaseIntentDto, PurchaseIntentStatus } from '@tutak/shared-types';
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

function IntentRow({
  intent,
  confirm,
  reject,
  rejecting,
  reasonCode,
  setReasonCode,
  onStartReject,
  onCancelReject,
}: {
  intent: PurchaseIntentDto;
  confirm: UseMutationResult<PurchaseIntentDto, unknown, string>;
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

  return (
    <Tr>
      <Td className="font-mono text-[12px] text-faint">{intent.id.slice(-8).toUpperCase()}</Td>
      <Td align="right" className="tabular font-medium">
        {num(intent.grossAmount)} ֏
      </Td>
      <Td align="right" className="tabular">
        {Number(intent.bonusAmountRequested) > 0 ? (
          <span className="text-reserved-text">−{num(intent.bonusAmountRequested)}</span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </Td>
      <Td>
        <Countdown expiresAt={intent.expiresAt} />
      </Td>
      <Td align="right">
        {expired ? (
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
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onStartReject}>
              Reject
            </Button>
            <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate(intent.id)}>
              Confirm
            </Button>
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
    mutationFn: (id: string) => purchaseIntentApi.confirm(id),
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

  const items = intents ?? [];

  return (
    <>
      <PageHeader
        title="Purchase requests"
        description="Customers who scanned your code and entered an amount. Confirm to complete the sale — the amount cannot be changed here."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No pending requests"
          message="A new request appears here the moment a customer submits one, and expires on its own after 3 minutes if nobody acts."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Bonus requested</Th>
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
