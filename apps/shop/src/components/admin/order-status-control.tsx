'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@prisma/client';
import { Loader2 } from 'lucide-react';
import { getDictionary } from '@/lib/i18n';
import { Button, Select, Textarea } from '@/components/ui';

const FLOW: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PAID',
  'IN_PRODUCTION',
  'READY',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

/** Status change writes an order event, which the customer sees in real time. */
export const OrderStatusControl = ({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) => {
  const router = useRouter();
  const dict = getDictionary('ru');
  const [next, setNext] = useState<OrderStatus>(status);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next, comment }),
    });
    setSaving(false);
    if (response.ok) {
      setComment('');
      router.refresh();
    } else {
      setError('Не удалось изменить статус');
    }
  };

  return (
    <div className="space-y-3">
      <Select value={next} onChange={(event) => setNext(event.target.value as OrderStatus)}>
        {FLOW.map((item) => (
          <option key={item} value={item}>
            {dict.orderStatus[item]}
          </option>
        ))}
      </Select>
      <Textarea
        placeholder="Комментарий к смене статуса (необязательно)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        className="min-h-20"
      />
      {error ? <p className="text-[12px] text-sale">{error}</p> : null}
      <Button onClick={apply} disabled={saving || next === status} className="w-full">
        {saving ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
        Изменить статус
      </Button>
    </div>
  );
};
