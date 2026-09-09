import { maskPhone } from './phone-mask';

/**
 * On a phone-first platform the number is the account identifier, so a log
 * of failed deliveries is a list of customers. These assertions are about
 * what the log line may still contain.
 */
describe('maskPhone', () => {
  it('keeps the country code and the last two digits, and nothing else', () => {
    expect(maskPhone('+37493600600')).toBe('+374******00');
  });

  it('never contains the number it was given', () => {
    for (const phone of ['+37493600600', '093600600', '37493600600', '+442071838750']) {
      const masked = maskPhone(phone);
      expect(masked).not.toContain(phone.replace(/\D/g, '').slice(0, -2));
      expect(masked.endsWith(phone.slice(-2))).toBe(true);
    }
  });

  it('leaves no country code on a number stored without one', () => {
    expect(maskPhone('093600600')).toBe('*******00');
  });

  it('reveals nothing at all about a value too short to be a number', () => {
    expect(maskPhone('12')).toBe('***');
    expect(maskPhone('')).toBe('***');
  });
});
