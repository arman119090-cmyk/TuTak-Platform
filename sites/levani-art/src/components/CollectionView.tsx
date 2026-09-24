import Link from 'next/link';
import type { Artwork, Category } from '@/content/types';
import { getArtworks, getPopulatedCategories } from '@/content/catalog';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { formatCount } from '@/i18n/plural';
import { ArtworkCard } from './ArtworkCard';
import { PageIntro } from './PageIntro';

/**
 * Filters are plain links to statically generated category pages, so the
 * collection works without JavaScript and every filter has its own URL.
 * Only categories that hold pieces are offered; future facets (artist,
 * material, setting, availability) plug into `facets` in content/filters.ts.
 */
export function CollectionView({
  locale,
  dict,
  active,
  items,
}: {
  locale: Locale;
  dict: Dictionary;
  active: Category | 'all';
  items: Artwork[];
}) {
  const c = dict.collection;
  const base = `/${locale}/collection`;
  const tabs: { key: Category | 'all'; href: string; label: string; count: number }[] = [
    { key: 'all', href: base, label: c.all, count: getArtworks().length },
    ...getPopulatedCategories().map((cat) => ({
      key: cat,
      href: `${base}/${cat}`,
      label: dict.categories[cat],
      count: getArtworks().filter((a) => a.category === cat).length,
    })),
  ];

  return (
    <div className="collection">
      <PageIntro
        eyebrow={c.eyebrow}
        title={active === 'all' ? c.title : dict.categories[active]}
        intro={active === 'all' ? c.intro : dict.categoryIntro[active]}
      />
      <nav className="filters" aria-label={c.filterLabel}>
        <ul>
          {tabs.map((t) => (
            <li key={t.key}>
              <Link href={t.href} aria-current={t.key === active ? 'page' : undefined} scroll={false}>
                {t.label}
                <sup>{t.count}</sup>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="collection__count" aria-live="polite">
        {formatCount(locale, items.length, c.count)}
      </p>
      {items.length ? (
        <ul className="gallery">
          {items.map((a, i) => (
            // The first row is on screen at load: no reveal, so it paints at once.
            <li key={a.slug} className={i < 3 ? undefined : 'reveal'}>
              <ArtworkCard artwork={a} locale={locale} dict={dict} priority={i < 3} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <h2>{c.emptyTitle}</h2>
          <p>{c.emptyText}</p>
        </div>
      )}
    </div>
  );
}
