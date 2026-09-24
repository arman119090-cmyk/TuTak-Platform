import type { Metadata } from 'next';
import { PageIntro } from '@/components/PageIntro';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/terms'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return {
    ...pageMetadata({ locale, path: '/terms', title: dict.legal.termsTitle, description: dict.legal.termsBody }),
    robots: { index: false },
  };
}

export default async function LegalPage({ params }: PageProps<'/[locale]/terms'>) {
  const { dict } = await resolveLocale(params);
  return (
    <div className="legal">
      <PageIntro eyebrow={dict.footer.legal} title={dict.legal.termsTitle} intro={dict.legal.termsBody} />
      <p className="legal__note">{dict.legal.placeholder}</p>
    </div>
  );
}
