import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { IdramAdapter } from './idram.adapter';

/**
 * The Idram checksum, pinned to the provider's documented composition.
 *
 * ## Why the expected value is a literal
 *
 * A test that rebuilt the digest with the same code it was checking would
 * pass whatever the field order happened to be — it would be testing that
 * MD5 is deterministic. The hex below was computed *outside* this codebase,
 * with the field order the owner read from the official Idram document:
 *
 *     EDP_REC_ACCOUNT : EDP_AMOUNT : SECRET_KEY : EDP_BILL_NO
 *       : EDP_PAYER_ACCOUNT : EDP_TRANS_ID : EDP_TRANS_DATE   → MD5, upper hex
 *
 * The first implementation put the secret *last*. Every locally-minted test
 * callback agreed with it, because they were minted by the same code, so the
 * suite was green while every real callback from Idram would have been
 * rejected as a forgery. This vector is what makes that class of mistake
 * visible: change the order and the literal stops matching.
 */
const MERCHANT = '110000110';
const SECRET = 'contract-secret-key';

const FIELDS = {
  EDP_REC_ACCOUNT: MERCHANT,
  EDP_AMOUNT: '14000.00',
  EDP_BILL_NO: 'bill-contract-1',
  EDP_PAYER_ACCOUNT: 'payer@example',
  EDP_TRANS_ID: 'IDRAM-TX-777',
  EDP_TRANS_DATE: '19/09/2026 12:34:56',
};

/** md5("110000110:14000.00:contract-secret-key:bill-contract-1:payer@example:IDRAM-TX-777:19/09/2026 12:34:56") */
const OFFICIAL_CHECKSUM = 'CF9A9178674067320EE1E57003BE6278';
/** The digest the secret-last order produces for the same fields. Must be refused. */
const SECRET_LAST_CHECKSUM = '0DC8C3767C1B75F2A66244246A89C89E';

describe('Idram provider contract', () => {
  const saved: Record<string, string | undefined> = {};
  let adapter: IdramAdapter;

  beforeAll(() => {
    for (const key of ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY'] as const) saved[key] = process.env[key];
    process.env.IDRAM_MERCHANT_ID = MERCHANT;
    process.env.IDRAM_SECRET_KEY = SECRET;
    const config = {
      get: () => ({ idramLanguage: 'AM', idramFormAction: 'https://sandbox.example/pay' }),
    } as unknown as ConfigService<AppConfig, true>;
    adapter = new IdramAdapter(config);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts a callback signed in the documented order', async () => {
    const result = await adapter.verifyCallback({}, { ...FIELDS, EDP_CHECKSUM: OFFICIAL_CHECKSUM });
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.billId).toBe('bill-contract-1');
      expect(result.providerTransactionId).toBe('IDRAM-TX-777');
      expect(result.amount.toFixed(2)).toBe('14000.00');
    }
  });

  it('refuses the same fields signed with the secret last', async () => {
    const result = await adapter.verifyCallback({}, { ...FIELDS, EDP_CHECKSUM: SECRET_LAST_CHECKSUM });
    expect(result.verified).toBe(false);
  });

  it('accepts a lower-case digest — the provider’s casing is not a signal', async () => {
    const result = await adapter.verifyCallback(
      {},
      { ...FIELDS, EDP_CHECKSUM: OFFICIAL_CHECKSUM.toLowerCase() },
    );
    expect(result.verified).toBe(true);
  });

  it('refuses a correct digest for a different merchant account', async () => {
    // Signed with our secret, but claims to be for another merchant. Whoever
    // signed it knows the secret; the merchant check still has to hold.
    const result = await adapter.verifyCallback(
      {},
      { ...FIELDS, EDP_REC_ACCOUNT: '999', EDP_CHECKSUM: OFFICIAL_CHECKSUM },
    );
    expect(result.verified).toBe(false);
  });
});
