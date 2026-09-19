import {
  assertIdempotencyToken,
  IDEMPOTENCY_TOKEN_PATTERN,
  InvalidIdempotencyTokenError,
} from '../../src/modules/yandex/yandex.port';
import {
  classifyRejection,
  extractTransactionId,
  normaliseStatus,
} from '../../src/modules/yandex/yandex-http.adapter';

describe('X-Idempotency-Token', () => {
  it('accepts 16 to 64 printable ASCII characters', () => {
    expect(() => assertIdempotencyToken('a'.repeat(16))).not.toThrow();
    expect(() => assertIdempotencyToken('a'.repeat(64))).not.toThrow();
    expect(() => assertIdempotencyToken('wd-01HXY-abc_def.ghi:jkl')).not.toThrow();
  });

  it('rejects anything outside that contract before a request is made', () => {
    expect(() => assertIdempotencyToken('a'.repeat(15))).toThrow(InvalidIdempotencyTokenError);
    expect(() => assertIdempotencyToken('a'.repeat(65))).toThrow(InvalidIdempotencyTokenError);
    expect(() => assertIdempotencyToken('')).toThrow(InvalidIdempotencyTokenError);
    expect(() => assertIdempotencyToken(`${'a'.repeat(15)}\n`)).toThrow(
      InvalidIdempotencyTokenError,
    );
    expect(() => assertIdempotencyToken(`${'a'.repeat(15)}ё`)).toThrow(
      InvalidIdempotencyTokenError,
    );
    // A non-breaking space looks printable and is outside the contract.
    expect(() => assertIdempotencyToken('a'.repeat(15) + String.fromCharCode(0xa0))).toThrow(
      InvalidIdempotencyTokenError,
    );
  });

  it('matches the tokens the withdrawal service generates', () => {
    // A UUID without dashes: 32 hex characters.
    const debit = 'a3f1c2d4e5b6478899aabbccddeeff00';
    expect(IDEMPOTENCY_TOKEN_PATTERN.test(debit)).toBe(true);
    expect(IDEMPOTENCY_TOKEN_PATTERN.test(`${debit}-rev`)).toBe(true);
  });
});

describe('v3 response interpretation', () => {
  it('finds the transaction id wherever the response puts it', () => {
    expect(extractTransactionId({ id: 'tx-1' })).toBe('tx-1');
    expect(extractTransactionId({ transaction_id: 42 })).toBe('42');
    expect(extractTransactionId({ transaction: { id: 'tx-3' } })).toBe('tx-3');
    expect(extractTransactionId({})).toBeNull();
    expect(extractTransactionId({ id: '' })).toBeNull();
  });

  it('normalises the documented status values and refuses to guess at others', () => {
    expect(normaliseStatus('in_progress')).toBe('IN_PROGRESS');
    expect(normaliseStatus('SUCCESS')).toBe('SUCCESS');
    expect(normaliseStatus('fail')).toBe('FAIL');
    expect(normaliseStatus(undefined)).toBeNull();
    expect(normaliseStatus('something_new')).toBe('UNRECOGNISED');
  });

  it('classifies a condition failure and an insufficient balance', () => {
    expect(classifyRejection('condition_not_met', 'balance_min not satisfied')).toBe(
      'condition_failed',
    );
    expect(classifyRejection('bad_request', 'insufficient funds')).toBe('insufficient_funds');
    expect(classifyRejection('contractor_blocked', 'the contractor is blocked')).toBe(
      'contractor_blocked',
    );
    expect(classifyRejection('', '')).toBe('rejected');
  });
});
