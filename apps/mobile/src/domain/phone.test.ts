import { localPhoneDigits } from './phone';

describe('localPhoneDigits', () => {
  it('keeps what is typed digit by digit', () => {
    expect(localPhoneDigits('9')).toBe('9');
    expect(localPhoneDigits('91234567')).toBe('91234567');
  });

  it('does not double the prefix when a whole number is pasted', () => {
    expect(localPhoneDigits('+374 91 234567')).toBe('91234567');
    expect(localPhoneDigits('+37491234567')).toBe('91234567');
    expect(localPhoneDigits('374-91-234-567')).toBe('91234567');
    expect(localPhoneDigits('(+374) 91 23 45 67')).toBe('91234567');
  });

  it('drops the trunk zero people write on paper', () => {
    expect(localPhoneDigits('091 234567')).toBe('91234567');
  });

  it('never returns more than eight digits', () => {
    expect(localPhoneDigits('912345678901')).toBe('91234567');
  });

  it('does not mistake a local number that happens to start with 374 or 0', () => {
    // Eight digits that start with 374 are a local number, not a prefix.
    expect(localPhoneDigits('37412345')).toBe('37412345');
    expect(localPhoneDigits('')).toBe('');
  });
});
