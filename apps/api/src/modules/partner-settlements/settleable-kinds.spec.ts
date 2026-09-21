import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ALLOCATION_LEDGER_KINDS,
  CLAIMABLE_LEDGER_KINDS,
  SETTLEABLE_LEDGER_KINDS,
  SETTLED_LEDGER_KINDS,
  unrecognisedKinds,
} from './settleable-kinds';

/**
 * Contract between the ledger writers and the settlement engine (audit
 * 21.09.2026, D01): every `kind` a source file writes while it also names
 * `PARTNER_PAYABLE` must be classified here — economic, allocation or
 * settled — or be explicitly listed below as a kind that file writes to
 * *other* accounts. A new writer that forgets this file fails this test
 * instead of leaving money outside every settlement.
 *
 * Static rather than a DB probe on purpose: the failure mode is a kind that
 * exists in code and never in a test fixture, which a runtime check cannot
 * see. The scan is deliberately over-inclusive (any `kind: '…'` literal in a
 * file that mentions the payable) and the exceptions are named one by one.
 */
const SRC = join(__dirname, '..');

/** Kinds written in files that mention `PARTNER_PAYABLE` but posted to other accounts. */
const NOT_ON_PARTNER_PAYABLE: ReadonlySet<string> = new Set([
  'balance.topup.completed', // customer-balance: PSP receivable ↔ customer prepaid balance
  'ev.roaming.balance_collection', // customer-balance: prepaid balance ↔ EV roaming receivable
  'customer.prepaid.hold', // customer-balance: available ↔ reserved
  'customer.prepaid.hold_released',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.includes('/test/')) out.push(full);
  }
  return out;
}

describe('settleable kinds — writer contract (audit D01)', () => {
  const writers = walk(SRC).filter((file) => readFileSync(file, 'utf8').includes('PARTNER_PAYABLE'));

  it('scans the writers that touch the partner payable', () => {
    expect(writers.length).toBeGreaterThan(5);
  });

  it('classifies every kind a payable writer posts', () => {
    const unclassified: string[] = [];
    for (const file of writers) {
      const source = readFileSync(file, 'utf8');
      const kinds = new Set<string>();
      for (const match of source.matchAll(/\bkind:\s*'([a-z0-9_.]+)'/g)) kinds.add(match[1]!);
      for (const match of source.matchAll(/\.reverse\([^,]+,\s*'([a-z0-9_.]+)'/g)) kinds.add(match[1]!);
      for (const kind of kinds) {
        if (NOT_ON_PARTNER_PAYABLE.has(kind)) continue;
        if (unrecognisedKinds([kind]).length > 0) {
          unclassified.push(`${relative(SRC, file)}: ${kind}`);
        }
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('keeps the three classes disjoint', () => {
    for (const kind of SETTLEABLE_LEDGER_KINDS) {
      expect(ALLOCATION_LEDGER_KINDS.has(kind)).toBe(false);
      expect(SETTLED_LEDGER_KINDS.has(kind)).toBe(false);
    }
    for (const kind of ALLOCATION_LEDGER_KINDS) expect(SETTLED_LEDGER_KINDS.has(kind)).toBe(false);
    expect(CLAIMABLE_LEDGER_KINDS.size).toBe(SETTLEABLE_LEDGER_KINDS.size + ALLOCATION_LEDGER_KINDS.size);
  });

  it('never claims the settled counterpart, and always claims allocations', () => {
    expect(CLAIMABLE_LEDGER_KINDS.has('partner.settlement.paid')).toBe(false);
    expect(CLAIMABLE_LEDGER_KINDS.has('payout.requested')).toBe(true);
    expect(CLAIMABLE_LEDGER_KINDS.has('partner.collection.confirmed')).toBe(true);
    expect(SETTLEABLE_LEDGER_KINDS.has('psp.payment.captured')).toBe(true);
    expect(unrecognisedKinds(['made.up.kind', 'psp.payment.captured'])).toEqual(['made.up.kind']);
  });
});
