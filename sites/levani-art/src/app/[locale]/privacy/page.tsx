// LEGAL REVIEW REQUIRED — draft text for the technical launch. The final
// privacy notice / terms must be written or approved by the owner's lawyer
// before this page is relied upon. Text lives in i18n dictionaries → `legal`.
import type { Metadata } from 'next';
import { PageIntro } from '@/components/PageIntro';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/privacy'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return {
    ...pageMetadata({ locale, path: '/privacy', title: dict.legal.privacyTitle, description: dict.legal.privacyBody }),
    robots: { index: false },
  };
}

export default async function LegalPage({ params }: PageProps<'/[locale]/privacy'>) {
  const { dict } = await resolveLocale(params);
  return (
    <div className="legal">
      <PageIntro eyebrow={dict.footer.legal} title={dict.legal.privacyTitle} intro={dict.legal.privacyBody} />
      <p className="legal__note">{dict.legal.placeholder}</p>
    </div>
  );
}
