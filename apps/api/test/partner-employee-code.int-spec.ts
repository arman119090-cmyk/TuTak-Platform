import { PrismaClient } from '@prisma/client';
import { PartnerEmployeeService } from '../src/modules/partners/partner-employee.service';
import { PartnerBranchStaffService } from '../src/modules/partners/partner-branch-staff.service';
import { createCustomer, createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * One person, one code, for as long as they work there — and the allocation
 * that has to survive two tills doing the same thing at once.
 *
 * The identity half is the requirement: a transfer between branches, a second
 * branch, a rehire on the same account must all resolve to the same code, and
 * a code released by a leaver must never reach somebody else.
 *
 * The allocation half is where the first attempt was wrong. Reading the
 * highest number from two tables and then inserting is a check followed by a
 * hope: two requests read the same maximum, both pick the same next code, and
 * the loser of the unique index is a request that simply fails. It is fixed
 * by an atomic per-partner counter, and these tests are what say so.
 */
describe('Partner employee codes (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let employees: PartnerEmployeeService;
  let branchStaff: PartnerBranchStaffService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    employees = harness.app.get(PartnerEmployeeService);
    branchStaff = harness.app.get(PartnerBranchStaffService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const branchOf = (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: { partnerId, name, address: `${name} 1`, city: 'Yerevan', latitude: 40.18, longitude: 44.51 },
    });

  // ── Identity ─────────────────────────────────────────────────────────

  it('gives the same person the same code however often it is asked', async () => {
    const partner = await createPartner(prisma);
    const { user } = await createCustomer(prisma);

    const first = await employees.codeFor(partner.id, user.id);
    const again = await employees.codeFor(partner.id, user.id);

    expect(first).toMatch(/^EMP-\d{3}$/);
    expect(again).toBe(first);
  });

  it('keeps one identity across a transfer and a second branch', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'PARTNER_STAFF' } })).id,
        partnerId: partner.id,
      },
    });
    const north = await branchOf(partner.id, 'North');
    const south = await branchOf(partner.id, 'South');

    await branchStaff.assign(partner.id, north.id, { userId: staff.id, assignedByUserId: owner.id });
    const afterFirst = await employees.codeFor(partner.id, staff.id);

    // A second branch, then the first posting ended — a transfer, in the two
    // steps a partner actually performs it in.
    await branchStaff.assign(partner.id, south.id, { userId: staff.id, assignedByUserId: owner.id });
    await prisma.partnerBranchStaffAssignment.updateMany({
      where: { partnerId: partner.id, userId: staff.id, partnerBranchId: north.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });

    expect(await employees.codeFor(partner.id, staff.id)).toBe(afterFirst);
    // Two postings, one person: the identity table never grew a second row.
    expect(await prisma.partnerEmployee.count({ where: { partnerId: partner.id } })).toBe(1);
  });

  it('never hands a leaver’s code to somebody else', async () => {
    const partner = await createPartner(prisma);
    const leaver = await createStaffUser(prisma);
    const joiner = await createStaffUser(prisma);

    const leaversCode = await employees.codeFor(partner.id, leaver.id);
    // Leaving is a matter of roles and assignments; the identity row stays.
    await prisma.userRole.deleteMany({ where: { userId: leaver.id, partnerId: partner.id } });

    const joinersCode = await employees.codeFor(partner.id, joiner.id);

    expect(joinersCode).not.toBe(leaversCode);
    // And the leaver is still resolvable — a purchase they confirmed in
    // March still names somebody.
    expect(await employees.codeFor(partner.id, leaver.id)).toBe(leaversCode);
  });

  it('separates partners: the same code at two partners is two people', async () => {
    const one = await createPartner(prisma, { displayName: 'One' });
    const two = await createPartner(prisma, { displayName: 'Two' });
    const a = await createStaffUser(prisma);
    const b = await createStaffUser(prisma);

    const codeA = await employees.codeFor(one.id, a.id);
    const codeB = await employees.codeFor(two.id, b.id);

    // Numbering restarts per partner, so this is expected rather than a
    // collision — and the lookup that resolves it is always partner-scoped.
    expect(codeB).toBe(codeA);
    expect((await employees.byCode(one.id, codeA))?.employee.user.id).toBe(a.id);
    expect((await employees.byCode(two.id, codeB))?.employee.user.id).toBe(b.id);
  });

  // ── Allocation under concurrency ─────────────────────────────────────

  it('gives two people two codes when both are created at once', async () => {
    const partner = await createPartner(prisma);
    const a = await createStaffUser(prisma);
    const b = await createStaffUser(prisma);

    const [codeA, codeB] = await Promise.all([
      employees.codeFor(partner.id, a.id),
      employees.codeFor(partner.id, b.id),
    ]);

    expect(codeA).not.toBe(codeB);
    expect(await prisma.partnerEmployee.count({ where: { partnerId: partner.id } })).toBe(2);
  });

  it('survives many at once without losing or repeating a code', async () => {
    const partner = await createPartner(prisma);
    const people = await Promise.all(Array.from({ length: 8 }, () => createStaffUser(prisma)));

    const codes = await Promise.all(people.map((p) => employees.codeFor(partner.id, p.id)));

    expect(new Set(codes).size).toBe(people.length);
  });

  it('asks twice for the same person concurrently and still writes one row', async () => {
    const partner = await createPartner(prisma);
    const { user } = await createCustomer(prisma);

    const [first, second] = await Promise.all([
      employees.codeFor(partner.id, user.id),
      employees.codeFor(partner.id, user.id),
    ]);

    expect(first).toBe(second);
    expect(await prisma.partnerEmployee.count({ where: { partnerId: partner.id } })).toBe(1);
  });

  it('does not collide with a historical assignment code', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'PARTNER_STAFF' } })).id,
        partnerId: partner.id,
      },
    });
    const branch = await branchOf(partner.id, 'Main');

    // An assignment carrying a hand-picked code well above the counter: the
    // shape a partner creates by naming codes themselves.
    await branchStaff.assign(partner.id, branch.id, {
      userId: staff.id,
      assignedByUserId: owner.id,
      employeeDisplayCode: 'EMP-042',
    });

    const newcomer = await createStaffUser(prisma);
    const code = await employees.codeFor(partner.id, newcomer.id);

    expect(code).not.toBe('EMP-042');
    expect(Number(code.slice('EMP-'.length))).toBeGreaterThan(42);
  });

  // ── A second writer, and the shapes a rollout produces ───────────────

  /**
   * During a rolling deploy the previous release is still running, and it
   * issues assignment codes the old way: read the highest `EMP-<n>` this
   * partner has and insert one past it. It knows nothing about the counter
   * and does not move it.
   *
   * This is that writer, reproduced exactly, so the tests below are about
   * the real failure rather than an imagined one.
   */
  const oldReleaseIssuesACode = async (partnerId: string, userId: string, branchId: string, by: string) => {
    const rows = await prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId },
      select: { employeeDisplayCode: true },
    });
    const highest = rows
      .map((r) => /^EMP-(\d+)$/.exec(r.employeeDisplayCode)?.[1])
      .filter((n): n is string => Boolean(n))
      .reduce((max, n) => Math.max(max, Number(n)), 0);
    return prisma.partnerBranchStaffAssignment.create({
      data: {
        partnerId,
        partnerBranchId: branchId,
        userId,
        employeeDisplayCode: `EMP-${String(highest + 1).padStart(3, '0')}`,
        assignedByUserId: by,
      },
    });
  };

  const hire = async (partnerId: string) => {
    const staff = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'PARTNER_STAFF' } })).id,
        partnerId,
      },
    });
    return staff;
  };

  it('walks past a number the previous release took behind the counter’s back', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const branch = await branchOf(partner.id, 'Main');
    const [first, second] = [await hire(partner.id), await hire(partner.id)];

    // The first posting costs two numbers: the person's permanent code and
    // the posting's own. One namespace, one counter — that is the price of
    // never showing two different people the same `EMP-` on one screen.
    const mine = await branchStaff.assign(partner.id, branch.id, {
      userId: first.id,
      assignedByUserId: owner.id,
    });
    expect(await employees.codeFor(partner.id, first.id)).toBe('EMP-001');
    expect(mine.employeeDisplayCode).toBe('EMP-002');

    // Old release, on the same database, draws by reading the highest posting
    // code and adding one. It does not touch the counter, so it lands on the
    // number the counter is about to hand out.
    const theirs = await oldReleaseIssuesACode(partner.id, second.id, branch.id, owner.id);
    expect(theirs.employeeDisplayCode).toBe('EMP-003');

    // Nothing in the database would have stopped the counter reusing that
    // number for a *permanent* code: the two tables have separate unique
    // indexes, so `EMP-003` could be one person's posting and another's
    // identity at the same time and neither index would object. The
    // allocator is what stops it.
    const third = await hire(partner.id);
    const permanent = await employees.codeFor(partner.id, third.id);
    const posting = await branchStaff.assign(partner.id, branch.id, {
      userId: third.id,
      assignedByUserId: owner.id,
    });

    expect(permanent).not.toBe('EMP-003');
    expect(posting.employeeDisplayCode).not.toBe('EMP-003');
    expect(new Set([permanent, posting.employeeDisplayCode, 'EMP-003']).size).toBe(3);
  });

  it('gives a permanent code even when the number it drew is taken', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const branch = await branchOf(partner.id, 'Main');
    const staff = await hire(partner.id);

    // A permanent code already exists on EMP-001 for somebody else, while the
    // counter still stands at 0 — the state a partial backfill leaves.
    const other = await createStaffUser(prisma);
    await prisma.partnerEmployee.create({
      data: { partnerId: partner.id, userId: other.id, code: 'EMP-001' },
    });
    expect(branch.id && owner.id).toBeTruthy();

    const code = await employees.codeFor(partner.id, staff.id);

    expect(code).not.toBe('EMP-001');
    expect(await employees.codeFor(partner.id, other.id)).toBe('EMP-001');
  });

  it('gives a rehired person their old code and a new assignment code', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const branch = await branchOf(partner.id, 'Main');
    const staff = await hire(partner.id);

    const first = await branchStaff.assign(partner.id, branch.id, {
      userId: staff.id,
      assignedByUserId: owner.id,
    });
    const permanent = await employees.codeFor(partner.id, staff.id);

    // Leaving: the posting is closed and the role removed. The rows stay.
    await branchStaff.deactivate(partner.id, first.id, owner.id);
    await prisma.userRole.deleteMany({ where: { userId: staff.id, partnerId: partner.id } });

    // Coming back months later, on the same account.
    await prisma.userRole.create({
      data: {
        userId: staff.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'PARTNER_STAFF' } })).id,
        partnerId: partner.id,
      },
    });
    const second = await branchStaff.assign(partner.id, branch.id, {
      userId: staff.id,
      assignedByUserId: owner.id,
    });

    // Same person, same identity — that is what the permanent code is for.
    expect(await employees.codeFor(partner.id, staff.id)).toBe(permanent);
    expect(await prisma.partnerEmployee.count({ where: { partnerId: partner.id } })).toBe(1);
    // Different posting, different posting code: the old one still names the
    // old stint, and reusing it would merge two periods of employment into
    // one on every historical row.
    expect(second.employeeDisplayCode).not.toBe(first.employeeDisplayCode);
  });

  it('gives eight people assigned at once eight different assignment codes', async () => {
    const partner = await createPartner(prisma);
    const owner = await createStaffUser(prisma);
    const branch = await branchOf(partner.id, 'Main');
    const people = await Promise.all(Array.from({ length: 8 }, () => hire(partner.id)));

    const assignments = await Promise.all(
      people.map((p) =>
        branchStaff.assign(partner.id, branch.id, { userId: p.id, assignedByUserId: owner.id }),
      ),
    );

    expect(new Set(assignments.map((a) => a.employeeDisplayCode)).size).toBe(8);
    // And the permanent codes minted alongside them are distinct too.
    const permanent = await prisma.partnerEmployee.findMany({ where: { partnerId: partner.id } });
    expect(new Set(permanent.map((p) => p.code)).size).toBe(8);
  });
});
