'use client';

import { useState } from 'react';
import { Ruler } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button } from '@/components/ui';
import { MeasurementDialog } from './request-dialog';

/** "Заказать замер" button — used on the kitchens page and in content pages. */
export const MeasureCta = ({
  locale,
  dict,
  variant = 'outline',
}: {
  locale: Locale;
  dict: Dictionary;
  variant?: 'primary' | 'outline' | 'secondary';
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="lg" onClick={() => setOpen(true)}>
        <Ruler width={17} height={17} />
        {dict.kitchen.measureCta}
      </Button>
      {open ? <MeasurementDialog locale={locale} dict={dict} onClose={() => setOpen(false)} /> : null}
    </>
  );
};
