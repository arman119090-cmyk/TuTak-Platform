import Link from 'next/link';
import { artworkUrl } from '@/lib/media/artwork';
import type { CategoryTree } from '@/lib/catalog/queries';
import type { Dictionary, Locale } from '@/lib/i18n';

const TONES: Record<string, string> = {
  sofas: 'emerald', armchairs: 'mustard', beds: 'beige', mattresses: 'white',
  wardrobes: 'oak', dressers: 'walnut', nightstands: 'ashWood', shelving: 'anthracite',
  tables: 'oak', chairs: 'navy', kitchens: 'olive', hallway: 'grey',
  kids: 'powder', office: 'graphite', 'living-room': 'graphite', doors: 'white',
};

/** The 16 top-level categories, each with its own generated key visual. */
export const CategoryGrid = ({
  tree,
  locale,
  dict,
}: {
  tree: CategoryTree;
  locale: Locale;
  dict: Dictionary;
}) => (
  <section className="container-page py-10 md:py-14">
    <div className="mb-6">
      <h2 className="text-[26px] md:text-[32px]">{dict.home.categories}</h2>
      <p className="mt-1.5 text-sm text-muted">{dict.home.categoriesSubtitle}</p>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {tree.map((root) => (
        <Link
          key={root.slug}
          href={`/${locale}/catalog/${root.slug}`}
          className="card-hover group overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl(root.artKey, TONES[root.slug] ?? 'beige', 0, root.slug.length + 3)}
            alt=""
            className="aspect-[4/3] w-full bg-surface-2 object-cover"
            loading="lazy"
          />
          <div className="flex items-baseline justify-between gap-2 px-3.5 py-3">
            <span className="text-[14px] leading-tight group-hover:text-accent">{root.name}</span>
            <span className="shrink-0 text-[12px] text-muted tabular-nums">{root.productCount}</span>
          </div>
        </Link>
      ))}
    </div>
  </section>
);
