import type { OrderStatus } from '@prisma/client';
import type { Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const TONES: Record<OrderStatus, string> = {
  NEW: 'bg-surface-3 text-ink-soft',
  CONFIRMED: 'bg-[#E8EEF4] text-[#33526F]',
  PAID: 'bg-success-soft text-success',
  IN_PRODUCTION: 'bg-[#FBF3E2] text-[#7A5A12]',
  READY: 'bg-[#EAF1EC] text-[#2F6B5A]',
  SHIPPED: 'bg-[#E9EDF6] text-[#3B4C86]',
  DELIVERED: 'bg-success-soft text-success',
  CANCELLED: 'bg-[#FBEAE8] text-[#8F2C23]',
};

export const OrderStatusBadge = ({
  status,
  dict,
  className,
}: {
  status: OrderStatus;
  dict: Dictionary;
  className?: string;
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium',
      TONES[status],
      className,
    )}
  >
    {dict.orderStatus[status]}
  </span>
);
