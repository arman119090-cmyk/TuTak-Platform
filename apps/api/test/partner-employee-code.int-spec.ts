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
});
