import { describe, expect, it } from 'vitest';
import { locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

type Tree = { [k: string]: unknown };

function leaves(obj: unknown, prefix = ''): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Tree).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  return [[prefix, obj]];
}

describe('dictionaries', () => {
  const en = new Map(leaves(getDictionary('en')));

  for (const locale of locales) {
    it(`${locale}: same keys as English, none empty`, () => {
      const entries = leaves(getDictionary(locale));
      const keys = entries.map(([k]) => k);
      // Plural objects legitimately differ (few/many exist only where the
      // language has them), so compare everything else exactly.
      const nonPlural = (k: string) => !/\.(pieces|count|results)\./.test(k);
      expect(keys.filter(nonPlural).sort()).toEqual([...en.keys()].filter(nonPlural).sort());
      for (const [k, v] of entries) {
        expect(typeof v, k).toBe('string');
        expect((v as string).trim().length, k).toBeGreaterThan(0);
      }
    });
  }

  it('keeps {placeholders} identical across locales', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const locale of locales) {
      for (const [k, v] of leaves(getDictionary(locale))) {
        const ref = en.get(k);
        if (typeof ref === 'string' && k !== 'artwork.by') expect(ph(v as string), `${locale} ${k}`).toBe(ph(ref));
      }
    }
  });
});
