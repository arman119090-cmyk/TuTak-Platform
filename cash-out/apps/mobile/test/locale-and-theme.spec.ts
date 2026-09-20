import { pickLocale } from '../src/i18n/detect';
import { parseThemePreference, resolveThemeName } from '../src/theme/resolve';

describe('language on first launch and after', () => {
  it('falls back to Armenian when nothing is stored and the phone speaks something else', () => {
    expect(pickLocale(null, ['fr', 'de'])).toBe('hy');
    expect(pickLocale(undefined, [])).toBe('hy');
  });

  it('takes the phone’s language when it is one we ship', () => {
    expect(pickLocale(null, ['ru', 'en'])).toBe('ru');
    expect(pickLocale(null, ['fr', 'en'])).toBe('en');
  });

  it('a stored choice wins over the phone', () => {
    expect(pickLocale('en', ['hy'])).toBe('en');
    expect(pickLocale('hy', ['ru'])).toBe('hy');
  });

  it('ignores a stored value that is not a locale', () => {
    expect(pickLocale('xx', ['ru'])).toBe('ru');
    expect(pickLocale(42, [])).toBe('hy');
  });
});

describe('theme persistence', () => {
  it('reads back light, dark and system, and defaults to light', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference(null)).toBe('light');
    expect(parseThemePreference('sepia')).toBe('light');
  });

  it('system follows the phone; an explicit choice does not', () => {
    expect(resolveThemeName('system', 'dark')).toBe('dark');
    expect(resolveThemeName('system', 'light')).toBe('light');
    expect(resolveThemeName('system', null)).toBe('light');
    expect(resolveThemeName('dark', 'light')).toBe('dark');
    expect(resolveThemeName('light', 'dark')).toBe('light');
  });
});
