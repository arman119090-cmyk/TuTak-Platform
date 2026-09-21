import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { Alert } from '@/components/ui';
import { ProfileForm } from '@/components/account/profile-form';

const SettingsPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.sub },
    select: { firstName: true, lastName: true, phone: true, email: true, locale: true },
  });

  return (
    <div className="space-y-6">
      <h2 className="text-[22px]">{dict.account.settings}</h2>
      <ProfileForm
        locale={locale}
        dict={dict}
        profile={{
          firstName: user.firstName,
          lastName: user.lastName ?? '',
          phone: user.phone ?? '',
          email: user.email,
          locale: user.locale,
        }}
      />
      <Alert tone="info" title={dict.common.demoBadge}>
        {locale === 'hy'
          ? 'Ցուցադրական ռեժիմում գաղտնաբառի փոփոխությունը և հաշվի ջնջումն անջատված են։'
          : locale === 'en'
            ? 'Password change and account deletion are disabled in demo mode.'
            : 'В демо-режиме смена пароля и удаление аккаунта отключены.'}
      </Alert>
    </div>
  );
};

export default SettingsPage;
