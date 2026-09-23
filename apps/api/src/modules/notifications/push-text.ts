/**
 * The words on the lock screen, in the customer's language.
 *
 * A push is composed once, by the server, and cannot be re-rendered when the
 * app opens — so unlike an inbox row, which stores translation keys, it has
 * to be written in the right language before it leaves. It used to be
 * English for everybody: an Armenian customer's first message from TuTak was
 * "Welcome to TuTak".
 *
 * These strings are the same sentences the app shows for the same
 * notification (`notifications.*` in `@tutak/i18n`). The API does not load
 * that package at runtime — its build compiles `src/` alone — so the few
 * lines a push needs are kept here, and `push-text.spec.ts` fails the moment
 * they stop matching the shared dictionary.
 */
export type PushLocale = 'hy' | 'ru' | 'en';

export const PUSH_TEXT = {
  welcome: {
    hy: {
      title: 'Բարի գալուստ TuTak!',
      body: 'Ձեր հաշիվը պատրաստ է։ Սկսեք վաստակել բոնուս միավորներ արդեն այսօր։',
    },
    ru: {
      title: 'Добро пожаловать в TuTak!',
      body: 'Ваш аккаунт готов. Начните зарабатывать бонусные баллы уже сегодня.',
    },
    en: {
      title: 'Welcome to TuTak!',
      body: 'Your account is ready. Start earning bonus points today.',
    },
  },
  paymentCompleted: {
    hy: { title: 'Վճարումն ավարտված է', body: '{{amount}} ֏' },
    ru: { title: 'Платёж выполнен', body: '{{amount}} ֏' },
    en: { title: 'Payment completed', body: '{{amount}} ֏' },
  },
} as const satisfies Record<string, Record<PushLocale, { title: string; body: string }>>;

/** The stored locale, or Armenian — the product's default — when it is not one we write in. */
export function pushLocale(stored: string | null | undefined): PushLocale {
  return stored === 'ru' || stored === 'en' || stored === 'hy' ? stored : 'hy';
}

/**
 * "1500.0000" → "1 500"; "1500.5000" → "1 500.5". The amount a customer
 * recognises, not the database's four-decimal string.
 */
export function formatPushAmount(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function pushText(
  kind: keyof typeof PUSH_TEXT,
  locale: PushLocale,
  params: Record<string, string> = {},
): { title: string; body: string } {
  const text = PUSH_TEXT[kind][locale];
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? '');
  return { title: fill(text.title), body: fill(text.body) };
}
