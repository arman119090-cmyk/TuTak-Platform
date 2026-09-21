import { prisma } from '@/lib/prisma';
import { artworkUrl } from '@/lib/media/artwork';
import { AdminHeading, Panel } from '@/components/admin/ui';
import { BannerToggle } from '@/components/admin/banner-toggle';

export const dynamic = 'force-dynamic';

const AdminBanners = async () => {
  const banners = await prisma.banner.findMany({
    orderBy: [{ position: 'asc' }, { sort: 'asc' }],
    include: { translations: { where: { locale: 'ru' } } },
  });

  return (
    <>
      <AdminHeading title="Баннеры" subtitle="Слайды главной страницы и промо-полоса" />
      <div className="grid gap-4 md:grid-cols-2">
        {banners.map((banner) => (
          <Panel key={banner.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artworkUrl(banner.artKey, 'beige', 3, banner.sort + 2)}
              alt=""
              className="aspect-[16/7] w-full rounded-t-[var(--radius-md)] bg-surface-2 object-cover"
            />
            <div className="p-4">
              <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
                {banner.position}
              </p>
              <h3 className="mt-1 text-[16px] font-sans font-semibold">
                {banner.translations[0]?.title ?? banner.key}
              </h3>
              <p className="mt-1 text-[13px] text-muted">{banner.translations[0]?.subtitle}</p>
              <p className="mt-2 text-[12px] text-muted">Ссылка: {banner.href}</p>
              <div className="mt-3">
                <BannerToggle id={banner.id} isActive={banner.isActive} />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
};

export default AdminBanners;
