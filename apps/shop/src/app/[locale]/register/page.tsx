import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getSession } from '@/lib/auth/session';
import { RegisterForm } from '@/components/auth/register-form';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.auth.registerTitle, robots: { index: false, follow: false } };
};

const RegisterPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await getSession();
  if (session) redirect(`/${locale}/account`);
  const dict = getDictionary(locale);

  return (
    <div className="container-page py-12 md:py-20">
      <RegisterForm locale={locale} dict={dict} />
    </div>
  );
};

export default RegisterPage;
