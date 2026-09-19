import { generateTotpSecret, otpauthUrl, totpCode, verifyTotp } from '../../src/modules/admin/totp';

describe('TOTP', () => {
  /**
   * RFC 6238's published SHA-1 test vectors, with the secret "12345678901234567890"
   * base32-encoded. Six digits rather than the RFC's eight, which is what every
   * authenticator app actually shows.
   */
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches the RFC 6238 vectors', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('produces a new code every 30 seconds', () => {
    // Aligned to a step boundary, so "+29s" really is inside the same window.
    const base = 1_700_000_010_000;
    expect(totpCode(RFC_SECRET, base)).toBe(totpCode(RFC_SECRET, base + 29_000));
    expect(totpCode(RFC_SECRET, base)).not.toBe(totpCode(RFC_SECRET, base + 31_000));
  });

  it('accepts the current code', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
  });

  it('tolerates one step of clock drift, and no more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now + 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 90_000), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now + 90_000), now)).toBe(false);
  });

  it('rejects anything that is not six digits', () => {
    const now = 1_700_000_000_000;
    for (const code of ['', '12345', '1234567', 'abcdef', '12 345']) {
      expect(verifyTotp(RFC_SECRET, code, now)).toBe(false);
    }
  });

  it('rejects a code from another secret', () => {
    const now = 1_700_000_000_000;
    const other = generateTotpSecret();
    expect(verifyTotp(RFC_SECRET, totpCode(other, now), now)).toBe(false);
  });

  it('generates base32 secrets an authenticator app can read', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    }
  });

  it('builds a valid enrolment URL', () => {
    const url = otpauthUrl(RFC_SECRET, 'ops@cashout.test');
    expect(url).toContain('otpauth://totp/Cash%20Out%3Aops%40cashout.test');
    expect(url).toContain(`secret=${RFC_SECRET}`);
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });
});
