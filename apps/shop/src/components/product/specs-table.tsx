import {
  COLORS,
  MATERIALS,
  PURPOSES,
  ROOMS,
  STYLES,
  specLabel,
  specValueLabel,
} from '@/data/attributes';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatDimensions } from '@/lib/utils';

type Row = { label: string; value: string };

/** One titled block of label/value rows. */
const Section = ({ title, rows }: { title: string; rows: Row[] }) =>
  rows.length === 0 ? null : (
    <div className="mb-8">
      <h3 className="mb-3 text-[17px]">{title}</h3>
      <dl className="overflow-hidden rounded-[var(--radius-md)] border border-line">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="flex flex-wrap gap-x-4 border-b border-line px-4 py-3 text-[13px] last:border-0 odd:bg-surface even:bg-surface-2/50"
          >
            <dt className="min-w-[45%] text-muted sm:min-w-[240px]">{row.label}</dt>
            <dd className="flex-1 text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

/**
 * Specification table.
 *
 * Products store canonical keys; every label and value is resolved through the
 * localized attribute dictionary, so the table is fully translated rather than
 * showing raw keys like "mechanism.eurobook".
 */
export const SpecsTable = ({
  product,
  locale,
  dict,
}: {
  product: {
    specs: Record<string, string | number | boolean>;
    colorKeys: string[];
    materialKeys: string[];
    styleKey: string;
    roomKey: string;
    purposeKey: string;
    widthMm: number | null;
    depthMm: number | null;
    heightMm: number | null;
    weightGram: number | null;
    country: string;
    warrantyMonths: number;
    sku: string;
    brandName: string;
    collectionName: string | null;
    productionDays: number;
  };
  locale: Locale;
  dict: Dictionary;
}) => {
  const countries: Record<string, string> = {
    AM: { hy: 'Հայաստան', ru: 'Армения', en: 'Armenia' }[locale],
    IT: { hy: 'Իտալիա', ru: 'Италия', en: 'Italy' }[locale],
    SE: { hy: 'Շվեդիա', ru: 'Швеция', en: 'Sweden' }[locale],
    PL: { hy: 'Լեհաստան', ru: 'Польша', en: 'Poland' }[locale],
  };

  const main: Row[] = [
    { label: dict.common.sku, value: product.sku },
    { label: dict.product.brand, value: product.brandName },
    ...(product.collectionName
      ? [{ label: dict.product.collection, value: product.collectionName }]
      : []),
    {
      label: dict.catalog.material,
      value: product.materialKeys.map((key) => MATERIALS[key]?.label[locale] ?? key).join(', '),
    },
    {
      label: dict.catalog.color,
      value: product.colorKeys.map((key) => COLORS[key]?.label[locale] ?? key).join(', '),
    },
    { label: dict.catalog.style, value: STYLES[product.styleKey]?.[locale] ?? product.styleKey },
    {
      label: ROOMS[product.roomKey] ? dict.catalog.title : dict.catalog.title,
      value: ROOMS[product.roomKey]?.[locale] ?? product.roomKey,
    },
    { label: dict.product.country, value: countries[product.country] ?? product.country },
    { label: dict.common.warranty, value: `${product.warrantyMonths} ${dict.common.months}` },
    ...(product.productionDays > 0
      ? [{ label: dict.common.production, value: `${product.productionDays} ${dict.common.days}` }]
      : [{ label: dict.common.production, value: dict.common.readyToShip }]),
    {
      label: PURPOSES[product.purposeKey] ? dict.catalog.title : dict.catalog.title,
      value: PURPOSES[product.purposeKey]?.[locale] ?? product.purposeKey,
    },
  ];

  const dimensions: Row[] = [
    ...(product.widthMm
      ? [{ label: `${dict.catalog.width}`, value: `${Math.round(product.widthMm / 10)} см` }]
      : []),
    ...(product.depthMm
      ? [
          {
            label:
              locale === 'hy' ? 'Խորություն, սմ' : locale === 'en' ? 'Depth, cm' : 'Глубина, см',
            value: `${Math.round(product.depthMm / 10)}`,
          },
        ]
      : []),
    ...(product.heightMm
      ? [
          {
            label:
              locale === 'hy' ? 'Բարձրություն, սմ' : locale === 'en' ? 'Height, cm' : 'Высота, см',
            value: `${Math.round(product.heightMm / 10)}`,
          },
        ]
      : []),
    ...(product.weightGram
      ? [
          {
            label: locale === 'hy' ? 'Քաշ, կգ' : locale === 'en' ? 'Weight, kg' : 'Вес, кг',
            value: `${Math.round(product.weightGram / 1000)}`,
          },
        ]
      : []),
    {
      label:
        locale === 'hy'
          ? 'Ընդհանուր չափսեր (Լ×Խ×Բ)'
          : locale === 'en'
            ? 'Overall (W×D×H)'
            : 'Габариты (Ш×Г×В)',
      value: `${formatDimensions(product.widthMm, product.depthMm, product.heightMm)} см`,
    },
  ];

  const specific: Row[] = Object.entries(product.specs).map(([key, value]) => ({
    label: specLabel(key, locale),
    value: specValueLabel(key, value, locale),
  }));

  return (
    <div>
      <Section title={dict.product.specs} rows={specific} />
      <Section title={dict.product.dimensions} rows={dimensions} />
      <Section title={dict.catalog.title} rows={main} />
    </div>
  );
};
