import {
  availableLocales,
  normaliseTranslations,
  readTranslations,
  resolvePromoCopy,
} from './promo-translations';

const full = { title: 'Coffee to go', subtitle: 'Until noon', benefitLabel: '10%' };

describe('resolvePromoCopy', () => {
  it('serves the requested locale when it is filled', () => {
    const copy = resolvePromoCopy({ hy: { ...full, title: 'Սուրճ' }, ru: full }, 'hy');
    expect(copy).toMatchObject({ locale: 'hy', title: 'Սուրճ' });
  });

  it('falls back to ru, then to the first filled locale', () => {
    expect(resolvePromoCopy({ ru: full, en: { ...full, title: 'EN' } }, 'hy')).toMatchObject({ locale: 'ru' });
    expect(resolvePromoCopy({ en: { ...full, title: 'EN' } }, 'hy')).toMatchObject({ locale: 'en', title: 'EN' });
  });

  it('treats a locale with a missing title or benefit as not filled', () => {
    expect(resolvePromoCopy({ hy: { title: '', benefitLabel: '10%' }, ru: full }, 'hy')).toMatchObject({ locale: 'ru' });
    expect(resolvePromoCopy({ hy: { title: 'Սուրճ', benefitLabel: '  ' }, ru: full }, 'hy')).toMatchObject({ locale: 'ru' });
  });

  it('resolves to nothing when no locale is filled — never an empty card', () => {
    expect(resolvePromoCopy({}, 'ru')).toBeNull();
    expect(resolvePromoCopy({ hy: { title: 'x', benefitLabel: '' } }, 'hy')).toBeNull();
  });

  it('ignores an unknown requested locale and trims what it returns', () => {
    expect(resolvePromoCopy({ ru: { title: ' Кофе ', subtitle: ' ', benefitLabel: ' 10% ' } }, 'de')).toEqual({
      locale: 'ru',
      title: 'Кофе',
      subtitle: null,
      benefitLabel: '10%',
    });
  });
});

describe('availableLocales / readTranslations / normaliseTranslations', () => {
  it('lists filled locales in interface order', () => {
    expect(availableLocales({ en: full, hy: full })).toEqual(['hy', 'en']);
  });

  it('reads a malformed column as nothing filled', () => {
    expect(readTranslations('oops' as never)).toEqual({});
    expect(readTranslations([] as never)).toEqual({});
    expect(availableLocales(readTranslations({ ru: { title: 'A', benefitLabel: 'B' } }))).toEqual(['ru']);
  });

  it('drops empty locales and blank subtitles before writing', () => {
    expect(
      normaliseTranslations({ hy: { title: '', benefitLabel: '' }, ru: { title: ' A ', subtitle: '', benefitLabel: 'B' } }),
    ).toEqual({ ru: { title: 'A', subtitle: null, benefitLabel: 'B' } });
  });
});
