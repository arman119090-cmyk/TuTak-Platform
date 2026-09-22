import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** A `Prisma.TransactionClient` or the client itself — either can run these. */
type Db = Prisma.TransactionClient | PrismaService;

const PREFIX = 'EMP-';

/**
 * The code a partner sees instead of a user id, and the one rule that makes
 * it worth having: it names a person, for as long as that person works
 * there.
 *
 * `PartnerBranchStaffAssignment.employeeDisplayCode` predates this and means
 * something narrower — an assignment to a branch. Both exist on purpose. The
 * assignment code is the audit trail of *postings to branches*; this one is
 * the identity a receipt, a statement line and an employee card all point
 * at. A transfer changes the first and must never change the second.
 *
 * Allocation is lazy. A code is minted the first time one is actually needed
 * — a branch assignment, or a confirmation by somebody who has never had one
 * — rather than for every user who happens to hold a partner-scoped role.
 * Minting up front would fill a partner's namespace with codes for people
 * who never touch a till, and `EMP-047` that has never appeared on anything
 * is not an identity, it is a gap somebody will ask about.
 */
@Injectable()
export class PartnerEmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * This person's permanent code at this partner, allocating one if they do
   * not have it yet.
   *
   * Safe to call on a path that must not fail for a display reason: a lost
   * race on the unique index is resolved by re-reading the row the winner
   * wrote, not by throwing. Two tills confirming at once must both succeed.
   */
  async codeFor(partnerId: string, userId: string, db: Db = this.prisma): Promise<string> {
    const existing = await db.partnerEmployee.findUnique({
      where: { partnerId_userId: { partnerId, userId } },
      select: { code: true },
    });
    if (existing) return existing.code;

    const code = await this.nextCode(partnerId, db);
    try {
      const created = await db.partnerEmployee.create({
        data: { partnerId, userId, code },
        select: { code: true },
      });
      return created.code;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Either this person was given a code by a concurrent request, or the
        // code we picked was taken by one. Both are answered by reading, and
        // only the first can answer *this* call — so a second collision is a
        // genuine failure rather than something to loop on.
        const won = await db.partnerEmployee.findUnique({
          where: { partnerId_userId: { partnerId, userId } },
          select: { code: true },
        });
        if (won) return won.code;
      }
      throw err;
    }
  }

  /**
   * `EMP-<n>`, one past the highest number this partner has issued — counting
   * **both** tables.
   *
   * Counting the assignment codes too is the point. They share the `EMP-`
   * shape and the partner's namespace, and a person's permanent code is
   * adopted from one of them by the migration. Numbering this table alone
   * would hand `EMP-002` to a new hire while an old assignment row still
   * shows `EMP-002` against somebody else — two people, one code, in two
   * places a partner reads side by side.
   */
  private async nextCode(partnerId: string, db: Db): Promise<string> {
    const [employees, assignments] = await Promise.all([
      db.partnerEmployee.findMany({
        where: { partnerId, code: { startsWith: PREFIX } },
        select: { code: true },
      }),
      db.partnerBranchStaffAssignment.findMany({
        where: { partnerId, employeeDisplayCode: { startsWith: PREFIX } },
        select: { employeeDisplayCode: true },
      }),
    ]);

    const highest = [
      ...employees.map((row) => row.code),
      ...assignments.map((row) => row.employeeDisplayCode),
    ].reduce((max, code) => {
      const n = Number(code.slice(PREFIX.length));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    return `${PREFIX}${String(highest + 1).padStart(3, '0')}`;
  }

  /**
   * Who a code belongs to, for the partner's own employee card.
   *
   * Scoped to one partner by the caller, and deliberately narrow in what it
   * returns: the person, their current branch assignments and whether each
   * is still active. No phone, no email, no user id — a partner checking
   * which of their staff confirmed a sale needs a name and a place, not a
   * way to contact somebody through the platform's records.
   */
  async byCode(partnerId: string, code: string) {
    const employee = await this.prisma.partnerEmployee.findUnique({
      where: { partnerId_code: { partnerId, code } },
      select: {
        code: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!employee) return null;

    const assignments = await this.prisma.partnerBranchStaffAssignment.findMany({
      where: { partnerId, userId: employee.user.id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        role: true,
        isActive: true,
        createdAt: true,
        deactivatedAt: true,
        branch: { select: { id: true, name: true, address: true } },
      },
    });

    // An all-branch grant is the other way a person is allowed to act, and a
    // partner looking at an empty branch list would otherwise read "assigned
    // nowhere" for somebody who may act everywhere.
    const roles = await this.prisma.userRole.findMany({
      where: { partnerId, userId: employee.user.id },
      select: { allBranches: true, role: { select: { name: true } } },
    });

    return { employee, assignments, roles };
  }
}
