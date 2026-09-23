'use client';

import { useTranslation } from 'react-i18next';
import { StorageNotice } from '@tutak/design/web';

/**
 * The storage notice in the language the rest of the panel is in.
 *
 * Its own component because the notice sits outside the dashboard layout,
 * at the root, where there is nothing else translated — and because a
 * Russian screen with one English paragraph pinned along the bottom of it
 * makes the whole translation look unfinished.
 */
export function LocalisedStorageNotice({ privacyUrl }: { privacyUrl?: string }) {
  const { t } = useTranslation();
  return (
    <StorageNotice
      privacyUrl={privacyUrl}
      copy={{
        regionLabel: t('partnerPanel.storageNotice.regionLabel'),
        body: t('partnerPanel.storageNotice.body'),
        privacyLink: t('partnerPanel.storageNotice.privacyLink'),
        acknowledge: t('partnerPanel.storageNotice.acknowledge'),
      }}
    />
  );
}
