import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18nResources, SUPPORTED_LOCALES } from '@tutak/i18n';
import {
  BonusEntryType,
  EvSessionStatus,
  LedgerDirection,
  TransactionStatus,
  TransactionType,
} from '@tutak/shared-types';

/**
 * The vocabulary has to say the same thing in three places.
 *
 * A status or entry type is declared in the Prisma schema, restated in
 * `@tutak/shared-types` for every client to compile against, and given a
 * human label in each of the three locales. Nothing enforced that chain, and
 * it broke twice in the same place without anybody noticing:
 *
 *  - `BonusEntryType` in shared-types was missing RESERVE_HOLD,
 *    RESERVE_RELEASE and PENDING_PROMOTION. The wallet screen fell through
 *    to `defaultValue` and printed the raw database enum at a customer.
 *  - `LedgerDirection` was missing NEUTRAL. That is worse than a missing
 *    label: it made `direction === 'CREDIT' ? gain : loss` look like it
 *    covered everything, so a transfer between the wallet's own buckets was
 *    shown as a deduction — the customer's own points, reported as lost.
 *
 * Both were found by looking at the built app, which is not a repeatable way
 * to find things. This is: the schema is the authority, the type mirrors it,
 * and every value a person can see has a label in every language.
 */

const SCHEMA = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

function prismaEnum(name: string): string[] {
  const match = SCHEMA.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  const body = match?.[1];
  if (body === undefined) throw new Error(`enum ${name} is not in schema.prisma`);
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .sort();
}

function typeMembers(e: Record<string, string>): string[] {
  return Object.values(e).sort();
}

describe('the shared types mirror the schema', () => {
  it.each([
    ['BonusEntryType', BonusEntryType],
    ['LedgerDirection', LedgerDirection],
    ['TransactionType', TransactionType],
    ['TransactionStatus', TransactionStatus],
    ['EvSessionStatus', EvSessionStatus],
  ])('%s', (name, declared) => {
    // Equality, not containment, in both directions. A type that omits a
    // value lets a client write a branch that misses it; a type that invents
    // one lets a client handle a case the database can never produce, which
    // reads as coverage and is not.
    expect(typeMembers(declared as unknown as Record<string, string>)).toEqual(prismaEnum(name));
  });
});

describe('every value a customer can see has a label in every language', () => {
  // The namespaces the mobile app looks up dynamically —
  // `t(`bonusEntryType.${entry.type}`)` and its siblings. Each has a
  // `defaultValue` fallback, which is why a gap here is silent at runtime:
  // the screen renders SCREAMING_SNAKE_CASE and carries on.
  const labelled: Array<[string, Record<string, string>]> = [
    ['bonusEntryType', BonusEntryType as unknown as Record<string, string>],
    ['transactionType', TransactionType as unknown as Record<string, string>],
    ['transactionStatus', TransactionStatus as unknown as Record<string, string>],
    ['evStatus', EvSessionStatus as unknown as Record<string, string>],
  ];

  for (const locale of SUPPORTED_LOCALES) {
    describe(locale, () => {
      it.each(labelled)('%s', (namespace, declared) => {
        const strings = (
          i18nResources[locale].translation as unknown as Record<string, Record<string, string>>
        )[namespace];

        if (!strings) throw new Error(`${locale} has no ${namespace} namespace at all`);

        const missing = typeMembers(declared).filter((member) => !strings[member]);
        expect(missing).toEqual([]);

        // A label that is only the enum name back again is a placeholder
        // somebody meant to come back to. It reads to a customer exactly like
        // the fallback this test exists to prevent.
        const untranslated = typeMembers(declared).filter((member) => strings[member] === member);
        expect(untranslated).toEqual([]);
      });
    });
  }
});

describe('interpolations agree across locales', () => {
  // "Expires in {{seconds}}s" was handed a value formatted as `14:57`, so
  // every locale read as a contradiction — the Russian one, "14:57 с",
  // literally says fourteen and a half thousand seconds. Renaming the
  // placeholder fixed that one; this keeps the three files from drifting
  // apart in the same way, where one locale interpolates a name the others
  // do not supply and silently renders `{{time}}`.
  const placeholders = (value: string): string[] =>
    (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();

  function walk(
    node: unknown,
    path: string,
    into: Map<string, string[]>,
  ): void {
    if (typeof node === 'string') {
      into.set(path, placeholders(node));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key, into);
      }
    }
  }

  it('every key takes the same placeholders in hy, ru and en', () => {
    const perLocale = new Map<string, Map<string, string[]>>();
    for (const locale of SUPPORTED_LOCALES) {
      const flat = new Map<string, string[]>();
      walk(i18nResources[locale].translation, '', flat);
      perLocale.set(locale, flat);
    }

    const [first, ...rest] = SUPPORTED_LOCALES;
    const reference = perLocale.get(first)!;
    const disagreements: string[] = [];

    for (const [key, names] of reference) {
      for (const locale of rest) {
        const other = perLocale.get(locale)!.get(key);
        if (other && JSON.stringify(other) !== JSON.stringify(names)) {
          disagreements.push(`${key}: ${first}=${names.join()} ${locale}=${other.join()}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});
