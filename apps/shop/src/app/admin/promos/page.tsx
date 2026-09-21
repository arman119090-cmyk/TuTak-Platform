import { prisma } from '@/lib/prisma';
import { AdminHeading } from '@/components/admin/ui';
import { PromoManager } from '@/components/admin/promo-manager';

export const dynamic = 'force-dynamic';

const AdminPromos = async () => {
  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <>
      <AdminHeading
        title="Промокоды"
        subtitle="Скидки применяются на сервере при расчёте корзины"
      />
      <PromoManager
        promos={promos.map((promo) => ({
          id: promo.id,
          code: promo.code,
          discountType: promo.discountType,
          value: promo.value,
          minSubtotalMinor: promo.minSubtotalMinor,
          maxDiscountMinor: promo.maxDiscountMinor,
          freeDelivery: promo.freeDelivery,
          usageLimit: promo.usageLimit,
          usedCount: promo.usedCount,
          isActive: promo.isActive,
          description: promo.description,
          endsAt: promo.endsAt ? promo.endsAt.toISOString() : null,
        }))}
      />
    </>
  );
};

export default AdminPromos;
