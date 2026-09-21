import { notFound } from 'next/navigation';
import { getDictionary, isLocale, fill } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { Breadcrumbs } from '@/components/ui';
import { AccountNav } from '@/components/account/account-nav';

const AccountLayout = async ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale, `/${locale}/account`);

  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ label: dict.common.home, href: `/${locale}` }, { label: dict.account.title }]} />
      <h1 className="mb-6 text-[30px] md:text-[38px]">
        {fill(dict.account.hello, { name: session.name })}
      </h1>
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-[170px] lg:self-start">
          <AccountNav locale={locale} dict={dict} />
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
};

export default AccountLayout;
