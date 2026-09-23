import { i18nResources } from '@tutak/i18n';
import { formatPushAmount, PUSH_TEXT, pushLocale, pushText } from './push-text';

type Bundle = { notifications: Record<string, string> };

describe('push text', () => {
  it.each(['hy', 'ru', 'en'] as const)('says what the app says, in %s', (locale) => {
    const app = (i18nResources[locale].translation as unknown as Bundle).notifications;
    expect(PUSH_TEXT.welcome[locale].title).toBe(app.welcomeTitle);
    expect(PUSH_TEXT.welcome[locale].body).toBe(app.welcomeBody);
    expect(PUSH_TEXT.paymentCompleted[locale].title).toBe(app.transactionCompletedTitle);
  });

  it('writes in the customer’s stored language, Armenian when there is none', () => {
    expect(pushText('welcome', pushLocale('ru')).title).toBe('Добро пожаловать в TuTak!');
    expect(pushLocale(null)).toBe('hy');
    expect(pushLocale('de')).toBe('hy');
  });

  it('shows the amount a customer recognises', () => {
    expect(formatPushAmount('1500.0000')).toBe('1 500');
    expect(formatPushAmount('1500.5000')).toBe('1 500.5');
    expect(formatPushAmount('999')).toBe('999');
    expect(
      pushText('paymentCompleted', 'hy', { amount: formatPushAmount('25000.0000') }).body,
    ).toBe('25 000 ֏');
  });
});
