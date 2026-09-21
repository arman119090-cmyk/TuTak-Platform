import Link from 'next/link';
import type { RequestType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AdminHeading } from '@/components/admin/ui';
import { RequestsInbox } from '@/components/admin/requests-inbox';

export const dynamic = 'force-dynamic';

const TYPES: { key: RequestType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  { key: 'KITCHEN', label: 'Кухни' },
  { key: 'MEASUREMENT', label: 'Замеры' },
  { key: 'DOOR', label: 'Двери' },
  { key: 'CALLBACK', label: 'Звонки' },
  { key: 'CUSTOM_SIZE', label: 'Инд. размеры' },
  { key: 'PRICE_REQUEST', label: 'Запрос цены' },
  { key: 'CONSULTATION', label: 'Консультации' },
];

const AdminRequests = async ({ searchParams }: { searchParams: Promise<{ type?: string }> }) => {
  const { type } = await searchParams;
  const active = TYPES.find((item) => item.key === type)?.key ?? 'ALL';

  const requests = await prisma.request.findMany({
    where: active === 'ALL' ? undefined : { type: active },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      product: { select: { translations: { where: { locale: 'ru' }, select: { name: true } } } },
    },
  });

  return (
    <>
      <AdminHeading title="Заявки" subtitle="Кухни, замеры, двери, звонки и запросы цены" />

      <div className="mb-4 flex flex-wrap gap-2">
        {TYPES.map((item) => (
          <Link
            key={item.key}
            href={item.key === 'ALL' ? '/admin/requests' : `/admin/requests?type=${item.key}`}
            className={`h-9 rounded-full border px-3 text-[13px] leading-[34px] ${
              active === item.key ? 'border-ink bg-ink text-white' : 'border-line bg-surface'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <RequestsInbox
        requests={requests.map((request) => ({
          id: request.id,
          type: request.type,
          status: request.status,
          name: request.name,
          phone: request.phone,
          email: request.email,
          comment: request.comment,
          payload: (request.payload ?? {}) as Record<string, unknown>,
          adminNote: request.adminNote,
          createdAt: request.createdAt.toISOString(),
          productName: request.product?.translations[0]?.name ?? null,
        }))}
      />
    </>
  );
};

export default AdminRequests;
