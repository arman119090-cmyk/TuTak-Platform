import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getDictionary, isLocale } from '@/lib/i18n';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from '@/components/auth/login-form';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : 'ru');
  return { title: dict.auth.loginTitle, robots: { index: false, follow: false } };
};

const LoginPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await getSession();
  if (session) redirect(`/${locale}/account`);
  const dict = getDictionary(locale);

  return (
    <div className="container-page py-12 md:py-20">
      <Suspense>
        <LoginForm locale={locale} dict={dict} />
      </Suspense>
    </div>
  );
};

export default LoginPage;
