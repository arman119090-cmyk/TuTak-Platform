import { createQuoteSchema, confirmWithdrawalSchema } from '../src/dto/withdrawal';
import { addPayoutMethodSchema } from '../src/dto/payout-method';
import { idempotencyKeySchema, moneySchema, phoneSchema } from '../src/dto/common';
import { requestOtpSchema, verifyOtpSchema } from '../src/dto/auth';

describe('wire contracts', () => {
  it('accepts only E.164 phone numbers', () => {
    expect(phoneSchema.safeParse('+37411223344').success).toBe(true);
    for (const bad of ['37411223344', '+0741122', '+374 11 22 33 44', 'tel:+37411223344', '']) {
      expect(phoneSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('carries money as an integer minor-unit string', () => {
    expect(moneySchema.safeParse({ minor: '123456', currency: 'AMD' }).success).toBe(true);
    expect(moneySchema.safeParse({ minor: '-1', currency: 'AMD' }).success).toBe(true);
    expect(moneySchema.safeParse({ minor: 123456, currency: 'AMD' }).success).toBe(false);
    expect(moneySchema.safeParse({ minor: '1234.56', currency: 'AMD' }).success).toBe(false);
    expect(moneySchema.safeParse({ minor: '1', currency: 'XYZ' }).success).toBe(false);
  });

  it('requires a URL-safe idempotency key of real length', () => {
    expect(idempotencyKeySchema.safeParse('a'.repeat(32)).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in it here').success).toBe(false);
  });

  it('refuses a quote request that is both an amount and "everything"', () => {
    const method = '11111111-1111-4111-8111-111111111111';
    expect(createQuoteSchema.safeParse({ payoutMethodId: method, all: true }).success).toBe(true);
    expect(
      createQuoteSchema.safeParse({
        payoutMethodId: method,
        amount: { minor: '100000', currency: 'AMD' },
      }).success,
    ).toBe(true);
    expect(
      createQuoteSchema.safeParse({
        payoutMethodId: method,
        all: true,
        amount: { minor: '100000', currency: 'AMD' },
      }).success,
    ).toBe(false);
    expect(createQuoteSchema.safeParse({ payoutMethodId: method }).success).toBe(false);
  });

  it('requires the quote signature on confirmation', () => {
    const base = {
      quoteId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'a'.repeat(32),
    };
    expect(confirmWithdrawalSchema.safeParse({ ...base, signature: 'abc' }).success).toBe(true);
    expect(confirmWithdrawalSchema.safeParse(base).success).toBe(false);
  });

  it('never accepts raw card data on the payout-method endpoint', () => {
    const asAny = addPayoutMethodSchema.safeParse({
      kind: 'CARD',
      pan: '4111111111111111',
      cvv: '123',
      currency: 'AMD',
    });
    expect(asAny.success).toBe(false);
    expect(
      addPayoutMethodSchema.safeParse({
        kind: 'CARD',
        providerToken: 'tok_live_abcdefgh',
        currency: 'AMD',
      }).success,
    ).toBe(true);
  });

  it('binds an OTP challenge to a device', () => {
    expect(
      requestOtpSchema.safeParse({ phone: '+37411223344', deviceId: 'device-1234' }).success,
    ).toBe(true);
    expect(requestOtpSchema.safeParse({ phone: '+37411223344' }).success).toBe(false);
    expect(
      verifyOtpSchema.safeParse({
        challengeId: '11111111-1111-4111-8111-111111111111',
        code: '123456',
        deviceId: 'device-1234',
      }).success,
    ).toBe(true);
    expect(
      verifyOtpSchema.safeParse({
        challengeId: '11111111-1111-4111-8111-111111111111',
        code: 'abcdef',
        deviceId: 'device-1234',
      }).success,
    ).toBe(false);
  });
});
