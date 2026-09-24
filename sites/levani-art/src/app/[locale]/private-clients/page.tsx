import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/PageIntro';
import { site, type AdvisoryKey, type AudienceKey } from '@/content/site';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/private-clients'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({
    locale,
    path: '/private-clients',
    title: dict.meta.privateClients,
    description: dict.meta.privateClientsDescription,
  });
}

export default async function PrivateClientsPage({ params }: PageProps<'/[locale]/private-clients'>) {
  const { locale, dict } = await resolveLocale(params);
  const t = dict.privateClients;
  const audiences = (Object.keys(site.audiences) as AudienceKey[]).filter((k) => site.audiences[k]);
  const advisory = (Object.keys(site.advisory) as AdvisoryKey[]).filter((k) => site.advisory[k]);
  const cta = `/${locale}/enquire?reason=trade`;
  return (
    <div className="private">
      <PageIntro eyebrow={t.eyebrow} title={t.title} intro={t.intro}>
        <Link href={cta} className="button button--solid">{t.cta}</Link>
      </PageIntro>
      <ol className="audiences">
        {audiences.map((k, i) => (
          <li key={k} className="audience reveal">
            <span className="audience__num">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="audience__title">{t.audiences[k].title}</h2>
            <p>{t.audiences[k].text}</p>
          </li>
        ))}
      </ol>
      {advisory.length ? (
        <section className="section advisory">
          <p className="eyebrow">{t.advisoryEyebrow}</p>
          <h2 className="section-title">{t.advisoryTitle}</h2>
          <ul className="advisory__list">
            {advisory.map((k) => (
              <li key={k}>
                <h3>{t.advisory[k].title}</h3>
                <p>{t.advisory[k].text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="about__cta">
        <Link href={cta} className="button button--solid">{t.cta}</Link>
      </div>
    </div>
  );
}
