import { pickLocale, translate } from './i18n';

describe('checkout i18n', () => {
  it('uses the same shared resources as the app, with interpolation', () => {
    expect(translate('ru', 'partnerOrder.webOpenInApp')).toBe('Открыть в TuTak');
    expect(translate('en', 'partnerOrder.prepaymentNotice', { amount: '20 000 ֏' })).toBe(
      'This order needs 20 000 ֏ paid in advance from your TuTak money.',
    );
  });

  it('falls back to English, then to the key', () => {
    expect(translate('hy', 'does.not.exist')).toBe('does.not.exist');
  });

  it('picks ?lang, then the browser language, then Armenian', () => {
    expect(pickLocale('ru')).toBe('ru');
    expect(pickLocale(null, ['en-US'])).toBe('en');
    expect(pickLocale('xx', ['de-DE'])).toBe('hy');
  });
});
