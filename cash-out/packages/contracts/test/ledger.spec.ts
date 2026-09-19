import {
  assertEntryBalances,
  GLOBAL_ACCOUNT_KEY,
  JournalEntryInput,
  LEDGER_ACCOUNT_TYPES,
  NORMAL_BALANCE,
  UnbalancedJournalEntryError,
} from '../src/ledger';

const posting = (
  accountType: (typeof LEDGER_ACCOUNT_TYPES)[number],
  direction: 'DEBIT' | 'CREDIT',
  amountMinor: string,
  currency = 'AMD',
  accountKey = GLOBAL_ACCOUNT_KEY,
) => ({ accountType, accountKey, direction, amountMinor, currency }) as const;

const entry = (postings: JournalEntryInput['postings']): JournalEntryInput => ({
  type: 'WITHDRAWAL_RESERVE',
  idempotencyKey: 'test',
  description: 'test',
  postings,
});

describe('the chart of accounts', () => {
  it('assigns a normal balance to every account type', () => {
    for (const accountType of LEDGER_ACCOUNT_TYPES) {
      expect(NORMAL_BALANCE[accountType]).toMatch(/^(DEBIT|CREDIT)$/);
    }
  });
});

describe('assertEntryBalances', () => {
  it('accepts a balanced entry', () => {
    expect(() =>
      assertEntryBalances(
        entry([
          posting('PARK_RECEIVABLE', 'DEBIT', '100000'),
          posting('DRIVER_PAYABLE', 'CREDIT', '100000'),
        ]),
      ),
    ).not.toThrow();
  });

  it('accepts a balanced multi-leg entry', () => {
    expect(() =>
      assertEntryBalances(
        entry([
          posting('DRIVER_PAYABLE', 'DEBIT', '8600'),
          posting('PLATFORM_FEE_REVENUE', 'CREDIT', '7000'),
          posting('PROVIDER_FEE_REVENUE', 'CREDIT', '1600'),
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects an entry that does not balance', () => {
    expect(() =>
      assertEntryBalances(
        entry([
          posting('PARK_RECEIVABLE', 'DEBIT', '100000'),
          posting('DRIVER_PAYABLE', 'CREDIT', '99999'),
        ]),
      ),
    ).toThrow(UnbalancedJournalEntryError);
  });

  it('balances per currency, not across currencies', () => {
    expect(() =>
      assertEntryBalances(
        entry([
          posting('PARK_RECEIVABLE', 'DEBIT', '100', 'AMD'),
          posting('DRIVER_PAYABLE', 'CREDIT', '100', 'RUB'),
        ]),
      ),
    ).toThrow(UnbalancedJournalEntryError);
  });

  it('rejects a single-leg entry', () => {
    expect(() => assertEntryBalances(entry([posting('PARK_RECEIVABLE', 'DEBIT', '100')]))).toThrow(
      UnbalancedJournalEntryError,
    );
  });

  it('rejects a negative posting instead of letting sign encode direction twice', () => {
    expect(() =>
      assertEntryBalances(
        entry([
          posting('PARK_RECEIVABLE', 'DEBIT', '-100'),
          posting('DRIVER_PAYABLE', 'CREDIT', '-100'),
        ]),
      ),
    ).toThrow(RangeError);
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '90071992547409930000';
    expect(() =>
      assertEntryBalances(
        entry([
          posting('PARK_RECEIVABLE', 'DEBIT', huge),
          posting('DRIVER_PAYABLE', 'CREDIT', huge),
        ]),
      ),
    ).not.toThrow();
  });
});
