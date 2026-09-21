import { clsx, type ClassValue } from 'clsx';

/** Conditional class names. Tailwind-friendly, no runtime merge magic needed. */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** URL-safe slug; transliterates Cyrillic so catalogue URLs stay readable. */
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const formatDate = (date: Date | string, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date);

export const formatDateTime = (date: Date | string, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'en' ? 'en-GB' : 'ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date);

/** Millimetres to the "Ш×Г×В" string shops print on labels. */
export const formatDimensions = (
  width?: number | null,
  depth?: number | null,
  height?: number | null,
): string =>
  [width, depth, height]
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .map((value) => Math.round(value / 10))
    .join(' × ');

export const pluralizeRu = (count: number, forms: [string, string, string]): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Deterministic pseudo-random generator — keeps the seeded demo reproducible. */
export const createRng = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
};
