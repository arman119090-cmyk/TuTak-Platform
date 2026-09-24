export type Plural = { other: string } & Partial<
  Record<'zero' | 'one' | 'two' | 'few' | 'many', string>
>;

export const plural = (forms: Plural): Plural => forms;

/** "18 pieces" / "18 работ" — picks the CLDR form for the locale. */
export function formatCount(locale: string, n: number, forms: Plural): string {
  const rule = new Intl.PluralRules(locale).select(n) as keyof Plural;
  return `${n} ${forms[rule] ?? forms.other}`;
}

/** Tiny `{name}` interpolation for dictionary strings. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
