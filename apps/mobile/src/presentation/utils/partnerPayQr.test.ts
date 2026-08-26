import { parsePartnerPayQr } from './partnerPayQr';

describe('parsePartnerPayQr', () => {
  it('extracts the partner id from a well-formed payload', () => {
    expect(parsePartnerPayQr('TUTAK-PAY:partner-sas')).toEqual({ partnerId: 'partner-sas' });
  });

  it('refuses a payload with no prefix, so an unrelated QR code is never mistaken for a partner code', () => {
    expect(parsePartnerPayQr('https://example.com')).toBeNull();
    expect(parsePartnerPayQr('some random text')).toBeNull();
  });

  it('refuses the legacy DYNAMIC_INVOICE-style opaque token, which carries no prefix at all', () => {
    expect(parsePartnerPayQr('a1b2c3d4e5f6a1b2c3d4e5f6')).toBeNull();
  });

  it('refuses a prefix with nothing after it', () => {
    expect(parsePartnerPayQr('TUTAK-PAY:')).toBeNull();
    expect(parsePartnerPayQr('TUTAK-PAY:   ')).toBeNull();
  });

  it('extracts a branch id when the partner printed a per-location code', () => {
    expect(parsePartnerPayQr('TUTAK-PAY:partner-sas:branch-downtown')).toEqual({
      partnerId: 'partner-sas',
      branchId: 'branch-downtown',
    });
  });
});
