'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { EmployeeCard } from '../EmployeeCard';

/**
 * The page a statement line or a receipt links to. Kept addressable by code
 * on purpose: somebody holding a printed receipt should be able to reach
 * this by typing the code they are looking at, and a settlement row should
 * be able to link straight here.
 */
export default function EmployeePage({ params }: { params: Promise<{ code: string }> }) {
  const { t } = useTranslation();
  const { code } = use(params);
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  return (
    <>
      <PageHeader
        title={t('partnerPanel.employees.cardTitle')}
        description={t('partnerPanel.employees.cardDescription')}
      />
      <div className="mb-4">
        <Link href="/employees" className="text-[13px] text-muted underline">
          {t('partnerPanel.employees.lookupAnother')}
        </Link>
      </div>
      <EmployeeCard partnerId={partnerId ?? ''} code={decodeURIComponent(code)} />
    </>
  );
}
