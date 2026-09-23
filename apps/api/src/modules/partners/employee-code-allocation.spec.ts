import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Only one allocator may hand out an `EMP-<n>`.
 *
 * Both codes a partner sees — the permanent one on `PartnerEmployee` and the
 * per-assignment one on `PartnerBranchStaffAssignment` — live in a single
 * `EMP-` namespace per partner, and both are issued by
 * `PartnerEmployeeService.nextCode` from the partner's own counter. That is
 * what makes the number unique under concurrency: an atomic
 * `UPDATE ... SET seq = seq + 1 RETURNING` rather than a read of the highest
 * code followed by an insert one past it.
 *
 * An atomic counter in one service proves nothing about a second writer. If
 * anything else ever inserts one of these columns — a backfill, a new
 * onboarding flow, an import — it will pick numbers by reading a maximum,
 * because that is the obvious thing to do, and the two allocators will
 * collide on a number neither of them knows the other drew.
 *
 * So this is a static check over the source rather than a behavioural one: it
 * fails when a *new file* writes one of these columns, before that file has
 * had a chance to produce a wrong number at runtime. Adding a writer is
 * fine — adding it to the list below is the part that makes somebody read
 * this docblock first.
 */
describe('employee codes come from one allocator', () => {
  const SRC = join(__dirname, '..', '..');

  /** Every file that may write a code, and why. */
  const ALLOWED_WRITERS = [
    // The allocator itself, and the only writer of the permanent code.
    'modules/partners/partner-employee.service.ts',
    // The assignment code, drawn from the same counter via `nextDisplayCode`.
    'modules/partners/partner-branch-staff.service.ts',
    // Demo data, outside the `EMP-` namespace entirely (`B-001`), and never
    // run against a real partner.
    'scripts/seed-demo.ts',
  ];

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      if (!full.endsWith('.ts') || full.endsWith('.spec.ts')) return [];
      return [full];
    });

  const files = sourceFiles(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    text: readFileSync(path, 'utf8'),
  }));

  it('has files to read at all', () => {
    // A scan that silently found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(100);
  });

  /**
   * Detected by the table write rather than by the column name: the column
   * is usually passed in shorthand (`employeeDisplayCode,`), so matching the
   * name would have missed the one writer that matters — which it did, on
   * the first draft of this test.
   */
  const WRITES_A_CODE_TABLE =
    /\b(partnerBranchStaffAssignment|partnerEmployee)\.(create|createMany|update|updateMany|upsert)\(/;

  it('writes to the tables holding a code only from the files that are meant to', () => {
    const writers = files
      .filter(({ text }) => WRITES_A_CODE_TABLE.test(text))
      .map(({ path }) => path)
      .sort();

    expect(writers).toEqual([...ALLOWED_WRITERS].sort());
  });

  it('draws a number from the counter and never from a maximum', () => {
    // `MAX(...)`, `orderBy: { code: 'desc' }`, `Math.max` over codes — the
    // three shapes a second allocator takes.
    const offenders = files
      .filter(({ path }) => !ALLOWED_WRITERS.includes(path))
      .filter(({ text }) =>
        /max\s*\(\s*["'`]?(code|employeeDisplayCode)|(code|employeeDisplayCode)["'`]?\s*:\s*["']desc["']/i.test(
          text,
        ),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps the counter bump atomic in the allocator itself', () => {
    const allocator = files.find(
      ({ path }) => path === 'modules/partners/partner-employee.service.ts',
    )!;

    // One statement, no read-then-write. The `RETURNING` is what makes the
    // drawn number this caller's alone.
    expect(allocator.text).toMatch(
      /UPDATE\s+"partners"\s+SET\s+"employeeCodeSeq"\s*=\s*"employeeCodeSeq"\s*\+\s*1/,
    );
    expect(allocator.text).toMatch(/RETURNING\s+"employeeCodeSeq"/);
    // And the hand-picked-code path raises the counter instead of ignoring it.
    expect(allocator.text).toMatch(/GREATEST\("employeeCodeSeq",/);
  });
});
