import { Quote } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Rating } from '@/components/ui';
import { formatDate } from '@/lib/utils';

/** Real rows from the Review table — the same ones shown on product pages. */
export const ReviewsSection = async ({ dict, locale }: { dict: Dictionary; locale: Locale }) => {
  const reviews = await prisma.review.findMany({
    where: { isPublished: true, rating: { gte: 4 }, title: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 6,
    include: {
      product: {
        include: {
          translations: { where: { locale } },
          images: { take: 1, orderBy: { sort: 'asc' } },
        },
      },
    },
  });
  if (reviews.length === 0) return null;

  return (
    <section className="container-page py-10 md:py-14">
      <div className="mb-6">
        <h2 className="text-[26px] md:text-[32px]">{dict.home.reviews}</h2>
        <p className="mt-1.5 text-sm text-muted">{dict.home.reviewsSubtitle}</p>
      </div>
      <div className="hide-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-3 md:px-0">
        {reviews.map((review) => (
          <figure
            key={review.id}
            className="flex w-[78vw] shrink-0 snap-start flex-col rounded-[var(--radius-md)] border border-line bg-surface p-5 sm:w-[46vw] md:w-auto"
          >
            <Quote width={22} height={22} className="mb-3 text-accent/60" />
            <Rating value={review.rating} showValue={false} />
            <blockquote className="mt-3 flex-1 text-[14px] leading-relaxed text-ink-soft">
              {review.body}
            </blockquote>
            <figcaption className="mt-4 border-t border-line pt-3 text-[12px] text-muted">
              <span className="font-medium text-ink">{review.authorName}</span>
              {' · '}
              {formatDate(review.createdAt, locale)}
              <span className="mt-1 block truncate">
                {review.product.translations[0]?.name ?? review.product.sku}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
};
