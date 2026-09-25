'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PartnerOrderDto, PartnerOrderStatus } from '@tutak/shared-types';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerOrderApi } from '@/lib/api/partnerOrderApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

const STATUS_TONE: Record<string, 'pending' | 'available' | 'danger' | 'neutral'> = {
  PAID: 'pending',
  PARTNER_SEEN: 'pending',
  STOCK_CONFIRMED: 'available',
  ACCEPTED: 'available',
  PREPARING: 'available',
  READY: 'available',
  SHIPPED: 'available',
  PICKUP_READY: 'available',
  COMPLETED: 'available',
  OUT_OF_STOCK: 'danger',
  SOURCING_REQUIRED: 'danger',
  SOURCING_IN_PROGRESS: 'danger',
  CUSTOMER_DECISION_REQUIRED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
};

/**
 * Spec §7/§10: the partner's own incoming-orders queue. Deliberately the
 * simplest screen in the whole cabinet — a new order shows only "УВИДЕЛ
 * ЗАКАЗ"; once seen, only "В НАЛИЧИИ"/"НЕТ В НАЛИЧИИ". Nothing here lets a
 * partner change the amount or mark an order PAID — see
 * `PartnerOrdersController`'s actual surface, which has no such route.
 */
export default function OrdersPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: orders } = useQuery({
    queryKey: ['partner-orders', partnerId],
    queryFn: () => partnerOrderApi.list(partnerId!),
    enabled: !!partnerId,
    refetchInterval: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['partner-orders', partnerId] });

  const markSeen = useMutation({
    mutationFn: (id: string) => partnerOrderApi.markSeen(id),
    onSuccess: invalidate,
  });
  const confirmStock = useMutation({
    mutationFn: (id: string) => partnerOrderApi.confirmStock(id),
    onSuccess: invalidate,
  });
  const rejectStock = useMutation({
    mutationFn: (id: string) => partnerOrderApi.rejectStock(id, { reason: reason || undefined }),
    onSuccess: () => {
      setRejectingId(null);
      setReason('');
      invalidate();
    },
  });

  const items = orders ?? [];

  return (
    <>
      <PageHeader
        title="Orders"
        description="Orders customers placed on your website through TuTak Checkout. Payment already happened — your only job is confirming whether the item is in stock."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No orders yet"
          message="A paid order from your website appears here the moment TuTak Checkout completes it."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Items</Th>
              <Th align="right">Total</Th>
              <Th>Status</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onSeen={() => markSeen.mutate(order.id)}
                seenPending={markSeen.isPending && markSeen.variables === order.id}
                onConfirmStock={() => confirmStock.mutate(order.id)}
                confirmPending={confirmStock.isPending && confirmStock.variables === order.id}
                rejecting={rejectingId === order.id}
                onStartReject={() => setRejectingId(order.id)}
                onCancelReject={() => {
                  setRejectingId(null);
                  setReason('');
                }}
                reason={reason}
                setReason={setReason}
                onConfirmReject={() => rejectStock.mutate(order.id)}
                rejectPending={rejectStock.isPending}
              />
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function OrderRow({
  order,
  onSeen,
  seenPending,
  onConfirmStock,
  confirmPending,
  rejecting,
  onStartReject,
  onCancelReject,
  reason,
  setReason,
  onConfirmReject,
  rejectPending,
}: {
  order: PartnerOrderDto;
  onSeen: () => void;
  seenPending: boolean;
  onConfirmStock: () => void;
  confirmPending: boolean;
  rejecting: boolean;
  onStartReject: () => void;
  onCancelReject: () => void;
  reason: string;
  setReason: (v: string) => void;
  onConfirmReject: () => void;
  rejectPending: boolean;
}) {
  const needsSeen = order.orderStatus === PartnerOrderStatus.PAID;
  const needsStock =
    order.orderStatus === PartnerOrderStatus.PAID || order.orderStatus === PartnerOrderStatus.PARTNER_SEEN;

  return (
    <Tr>
      <Td className="font-mono text-[12px] text-faint">#{order.orderNumber}</Td>
      <Td>
        {order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
      </Td>
      <Td align="right" className="tabular font-medium">
        {num(order.totalAmount)} ֏
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[order.orderStatus] ?? 'neutral'}>{order.orderStatus.replace(/_/g, ' ')}</Badge>
      </Td>
      <Td align="right">
        {needsSeen ? (
          <Button size="sm" loading={seenPending} onClick={onSeen}>
            УВИДЕЛ ЗАКАЗ
          </Button>
        ) : needsStock ? (
          rejecting ? (
            <div className="flex items-center justify-end gap-2">
              <Input
                autoFocus
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8 w-40 text-[13px]"
              />
              <Button size="sm" variant="destructive" loading={rejectPending} onClick={onConfirmReject}>
                Confirm
              </Button>
              <Button size="sm" variant="secondary" onClick={onCancelReject}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="destructive" onClick={onStartReject}>
                НЕТ В НАЛИЧИИ
              </Button>
              <Button size="sm" loading={confirmPending} onClick={onConfirmStock}>
                В НАЛИЧИИ
              </Button>
            </div>
          )
        ) : (
          <span className="text-[12px] text-faint">—</span>
        )}
      </Td>
    </Tr>
  );
}
