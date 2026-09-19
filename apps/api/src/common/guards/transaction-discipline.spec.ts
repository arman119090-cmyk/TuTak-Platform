import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bug that turned CI red on 15.09.2026, made impossible to reintroduce
 * quietly.
 *
 * ## What happened
 *
 * `settleVerifiedConfirmation` ran inside `prisma.$transaction(async tx =>
 * ...)` and, from within it, called helpers that read through the *global*
 * client instead of `tx`. Each such read takes a second connection out of the
 * same pool while the transaction is still holding one. Five concurrent
 * provider callbacks held all five connections in a CI-sized pool, every one
 * of them waited for a sixth that could not exist, and all five died at
 * Prisma's interactive-transaction timeout. The duplicate-callback burst
 * settled *nothing*, where exactly one settlement was required.
 *
 * ## Why a test rather than a code review rule
 *
 * Because it already survived one code review — mine — and was written back
 * into the codebase a second time by a comment that explained the wrong
 * diagnosis confidently. A reviewer has to notice; a test does not.
 *
 * ## What it does and does not flag
 *
 * Only the *interactive* form, `$transaction(async ...)`. The array form,
 * `$transaction([ this.prisma.a.update(...), ... ])`, is required to build
 * its operations from the global client and is correct — flagging it would
 * have made this guard noise, and noise gets deleted.
 *
 * Nested `$transaction` inside an interactive one is flagged too: Prisma has
 * no nested transactions, so the inner one silently takes its own connection
 * and commits independently of the outer — "both or neither" stops being
 * true without anything failing.
 */

const SRC = join(__dirname, '..', '..');

function typescriptFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return typescriptFilesUnder(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * Methods that accept an optional transaction and silently use the global
 * client without one. Kept as a list rather than discovered, so adding a
 * wrapper is a deliberate act that names the risk.
 */
const WRAPPER_CALL =
  /this\.(?:ledger\.(?:accountFor|post|reverse)|bonusEngine\.(?:accrue|settleReservation|releaseReservation|reverseSettlement|reverseAccrualLot)|transactionsService\.(?:create|markCompleted|markFailed|markFlagged)|audit\.record|referralService\.resolveReferralChain|purchases\.settleFromProviderConfirmation|findByIdOrThrow|contributionFor|hasUnsafeAttempt|hasUnsafePspAttempt|assertDirectCollectionAllowed)\(/;

/** The text of one call, from its opening parenthesis to the matching close. */
function balancedCallText(lines: string[], startLine: number, startCol: number): string {
  let depth = 0;
  let text = '';
  for (let i = startLine; i < lines.length && i < startLine + 40; i += 1) {
    const line = i === startLine ? lines[i]!.slice(startCol) : lines[i]!;
    for (const ch of line) {
      text += ch;
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) return text;
      }
    }
    text += '\n';
  }
  return text;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  why: string;
}

/**
 * A deliberately simple brace walker rather than a TypeScript AST pass.
 *
 * The pattern is lexical — "this text appears between these braces" — and a
 * full parser would add a dependency and a lot of machinery to answer a
 * question that indentation already answers. A false negative here costs a
 * missed review comment; it is not the only defence.
 */
function findViolations(): Violation[] {
  const found: Violation[] = [];

  for (const file of typescriptFilesUnder(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let openedAt: number | null = null;
    let depth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

      if (openedAt === null) {
        // Interactive form only: `$transaction(async`. The array form is
        // correct with the global client and must not be flagged.
        if (/\$transaction\(\s*async/.test(code)) {
          openedAt = depth;
          depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
          continue;
        }
        depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
        continue;
      }

      depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
      if (depth <= openedAt) {
        openedAt = null;
        continue;
      }

      if (/this\.prisma\.[a-zA-Z$]/.test(code)) {
        found.push({
          file: file.slice(SRC.length + 1),
          line: i + 1,
          text: code.trim().slice(0, 90),
          why: 'reads through the global client while a transaction is open — takes a second pool connection',
        });
      }

      /*
       * The indirect form of the same bug: a service method that takes an
       * optional `tx` and falls back to the global client when it is not
       * given one. `this.ledger.accountFor({...})` inside a transaction is
       * exactly `this.prisma.ledgerAccount.findFirst` one call deeper, and
       * it borrowed the second connection just the same. The call text is
       * gathered until its parentheses balance, so a multi-line call or one
       * inside `Promise.all([...])` is read whole before asking whether `tx`
       * is among its arguments.
       */
      const wrapper = WRAPPER_CALL.exec(code);
      if (wrapper) {
        const callText = balancedCallText(lines, i, code.indexOf(wrapper[0]));
        if (!/\btx\b/.test(callText) && !/\bclient\b/.test(callText)) {
          found.push({
            file: file.slice(SRC.length + 1),
            line: i + 1,
            text: code.trim().slice(0, 90),
            why: `calls ${wrapper[0].replace(/\($/, '')} without passing the transaction — it falls back to the global client`,
          });
        }
      }
      if (/\$transaction\(/.test(code)) {
        found.push({
          file: file.slice(SRC.length + 1),
          line: i + 1,
          text: code.trim().slice(0, 90),
          why: 'opens a transaction inside a transaction — Prisma has no nesting, so it commits independently',
        });
      }
    }
  }

  return found;
}

describe('transaction discipline', () => {
  it('nothing inside an interactive transaction touches the global client', () => {
    const violations = findViolations();
    // Listed rather than counted, so a failure names the file and line to fix
    // instead of saying a number went up.
    expect(violations.map((v) => `${v.file}:${v.line} — ${v.why}\n    ${v.text}`)).toEqual([]);
  });

  /**
   * The guard has to be able to fail, or it is decoration. This drives the
   * same walker over a snippet carrying the exact shape of the original bug.
   */
  it('would have caught the bug it was written for', () => {
    const offending = [
      'async settle() {',
      '  return this.prisma.$transaction(async (tx) => {',
      '    const account = await this.prisma.ledgerAccount.findFirst({ where: {} });',
      '    return tx.pspPaymentAttempt.update({ where: { id: account.id }, data: {} });',
      '  });',
      '}',
    ];

    let openedAt: number | null = null;
    let depth = 0;
    const caught: number[] = [];
    for (let i = 0; i < offending.length; i += 1) {
      const code = offending[i]!;
      if (openedAt === null) {
        if (/\$transaction\(\s*async/.test(code)) {
          openedAt = depth;
          depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
          continue;
        }
        depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
        continue;
      }
      depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
      if (depth <= openedAt) {
        openedAt = null;
        continue;
      }
      if (/this\.prisma\.[a-zA-Z$]/.test(code)) caught.push(i + 1);
    }

    expect(caught).toEqual([3]);
  });

  /**
   * The indirect form must be caught too — this is the shape that survived
   * the first guard, because nothing in it says `this.prisma`.
   */
  it('catches a wrapper called without the transaction, across lines', () => {
    const lines = [
      '    const [a, b] = await Promise.all([',
      '      this.ledger.accountFor({',
      '        type: LedgerAccountType.PARTNER_PAYABLE,',
      '      }),',
      '      this.ledger.accountFor({ type: LedgerAccountType.PLATFORM_BANK }, tx),',
      '    ]);',
    ];
    const first = balancedCallText(lines, 1, lines[1]!.indexOf('this.ledger'));
    const second = balancedCallText(lines, 4, lines[4]!.indexOf('this.ledger'));
    expect(/\btx\b/.test(first)).toBe(false);
    expect(/\btx\b/.test(second)).toBe(true);
  });

  /** And must not flag the array form, which is correct as written. */
  it('leaves the batch form alone', () => {
    const batch = [
      'await this.prisma.$transaction([',
      '  this.prisma.payment.update({ where: {}, data: {} }),',
      ']);',
    ].join('\n');
    expect(/\$transaction\(\s*async/.test(batch)).toBe(false);
  });
});
