'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PurchaseIntentStatus } from '@tutak/shared-types';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

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
              <Th align="right">Amount</Th>
              <Th align="right">Bonus requested</Th>
              <Th>Expires</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((intent) => (
              <Tr key={intent.id}>
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
                  <Badge tone="pending">
                    {new Date(intent.expiresAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Badge>
                </Td>
                <Td align="right">
                  {rejectingId === intent.id ? (
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
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRejectingId(null);
                          setReasonCode('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setRejectingId(intent.id)}>
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        loading={confirm.isPending}
                        onClick={() => confirm.mutate(intent.id)}
                      >
                        Confirm
                      </Button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
