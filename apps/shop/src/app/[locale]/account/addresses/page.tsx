import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getDictionary, isLocale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth/guards';
import { AddressesManager } from '@/components/account/addresses-manager';

const AddressesPage = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const session = await requireUser(locale);

  const addresses = await prisma.address.findMany({
    where: { userId: session.sub },
    orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
  });

  return (
    <div>
      <h2 className="mb-4 text-[22px]">{dict.account.addresses}</h2>
      <AddressesManager
        locale={locale}
        dict={dict}
        addresses={addresses.map((address) => ({
          id: address.id,
          label: address.label,
          region: address.region,
          city: address.city,
          street: address.street,
          building: address.building,
          apartment: address.apartment,
          floor: address.floor,
          hasLift: address.hasLift,
          isDefault: address.isDefault,
        }))}
      />
    </div>
  );
};

export default AddressesPage;
