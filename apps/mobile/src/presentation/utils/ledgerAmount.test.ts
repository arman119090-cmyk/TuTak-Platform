import { LedgerDirection } from '@tutak/shared-types';
import { ledgerAmountFor } from './transactionPresentation';

/**
 * The wallet screen is a statement of somebody's points, so a sign on the
 * wrong row is not a cosmetic defect — it tells a customer they lost
 * something they still have.
 *
 * That is what shipped. `direction === 'CREDIT' ? +amount : -amount` is right
 * for CREDIT and DEBIT and wrong for NEUTRAL, and the demo customer's history
 * read:
 *
 *     Became available    −302.5
 *     Earned on purchase  +302.5
 *
 * Both lines describe the same 302.5 points. Nothing was deducted.
 *
 * The branch looked exhaustive because `LedgerDirection` in shared-types
 * listed two of the three values the API sends. So the enum is imported here
 * rather than restating the strings: if a fourth direction is ever added, the
 * last test in this file fails until somebody decides how it should read.
 */
describe('ledgerAmountFor', () => {
  it('shows an accrual as a gain', () => {
    expect(ledgerAmountFor(LedgerDirection.CREDIT, '302.5')).toEqual({
      value: '+302.5',
      tone: 'positive',
    });
  });

  it('shows a redemption as a loss', () => {
    expect(ledgerAmountFor(LedgerDirection.DEBIT, '150')).toEqual({
      value: '−150',
      tone: 'default',
    });
  });

  it.each([
    ['points becoming available after the cooling-off window', '302.5'],
    ['points held against a payment being started', '150'],
    ['a hold released when the payment did not complete', '150'],
  ])('shows %s with no sign at all', (_case, amount) => {
    const shown = ledgerAmountFor(LedgerDirection.NEUTRAL, amount);

    expect(shown.value).not.toContain('−');
    expect(shown.value).not.toContain('-');
    expect(shown.value).not.toContain('+');
    expect(shown.tone).toBe('default');
  });

  it('formats a transfer the same way the balance above it is formatted', () => {
    // 1 234.5, with the same thin space the wallet total uses. A row reading
    // "1234.5" beside a total reading "1 234.5" invites the reader to think
    // they are different numbers.
    expect(ledgerAmountFor(LedgerDirection.NEUTRAL, '1234.5').value).toBe('1 234.5');
  });

  it('ignores a sign already present in the amount', () => {
    // The API sends magnitudes; direction carries the sign. A negative string
    // arriving here means something upstream changed, and the row must not
    // silently become "+-150" or "−−150".
    expect(ledgerAmountFor(LedgerDirection.DEBIT, '-150').value).toBe('−150');
    expect(ledgerAmountFor(LedgerDirection.CREDIT, '-150').value).toBe('+150');
  });

  it('covers every direction the shared enum declares', () => {
    // Not a formality: the bug was a branch that handled two of three. A new
    // member added to the enum arrives here before it reaches a customer.
    for (const direction of Object.values(LedgerDirection)) {
      expect(() => ledgerAmountFor(direction, '10')).not.toThrow();
    }
    expect(Object.values(LedgerDirection).sort()).toEqual(['CREDIT', 'DEBIT', 'NEUTRAL']);
  });
});
