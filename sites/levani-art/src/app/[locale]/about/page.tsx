import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { artworkAlt } from '@/components/ArtworkCard';
import { LogoPlate } from '@/components/Brand';
import { getArtwork } from '@/content/catalog';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/about'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({ locale, path: '/about', title: dict.meta.about, description: dict.meta.aboutDescription });
}

export default async function AboutPage({ params }: PageProps<'/[locale]/about'>) {
  const { locale, dict } = await resolveLocale(params);
  const t = dict.about;
  const pictures = ['old-town-street', 'lion-serpent', 'imperial-malachite-pedestal']
    .map(getArtwork)
    .filter((a) => a !== undefined);
  return (
    <div className="about">
      <section className="about__hero">
        <div className="about__plate reveal">
          <LogoPlate width={260} priority />
        </div>
        <div className="about__intro reveal">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="page-intro__title">{t.title}</h1>
          <p className="about__lead">{t.lead}</p>
          {t.body.map((p) => <p key={p} className="section-text">{p}</p>)}
        </div>
      </section>
      <ul className="pillars">
        {t.pillars.map((p, i) => {
          const a = pictures[i];
          return (
            <li key={p.title} className="pillar reveal">
              {a ? (
                <Link href={`/${locale}/artworks/${a.slug}`} className="pillar__img">
                  <Image src={a.image.src} width={a.image.width} height={a.image.height} alt={artworkAlt(a, dict)} sizes="(max-width: 900px) 92vw, 30vw" />
                </Link>
              ) : null}
              <h2 className="pillar__title">{p.title}</h2>
              <p>{p.text}</p>
            </li>
          );
        })}
      </ul>
      <div className="about__cta">
        <Link href={`/${locale}/collection`} className="button button--solid">{t.cta}</Link>
      </div>
    </div>
  );
}
