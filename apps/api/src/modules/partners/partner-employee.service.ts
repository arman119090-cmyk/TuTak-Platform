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
   * The next `EMP-<n>` for this partner, taken from the partner's own
   * counter in one atomic statement.
   *
   * The first version read the highest code already issued and inserted one
   * past it, which is a check followed by a hope: two requests read the same
   * maximum, choose the same code, and the loser of the unique index is a
   * request that fails. Eight concurrent allocations reproduced it.
   *
   * `UPDATE ... SET seq = seq + 1 RETURNING seq` has no such window.
   * PostgreSQL takes the row lock for the duration of the statement, so
   * concurrent callers queue behind it and each leaves with a different
   * number. Nothing to release, no retry loop to get subtly wrong, and the
   * uniqueness is the database's guarantee rather than this file's.
   *
   * Public because the older per-assignment display code is allocated from
   * the same namespace and must come from the same counter — a counter half
   * the writers ignore is not a counter.
   */
  async nextCode(partnerId: string, db: Db = this.prisma): Promise<string> {
    const [row] = await db.$queryRaw<{ employeeCodeSeq: number }[]>`
      UPDATE "partners"
      SET "employeeCodeSeq" = "employeeCodeSeq" + 1
      WHERE "id" = ${partnerId}
      RETURNING "employeeCodeSeq"
    `;
    if (!row) throw new Error(`No such partner: ${partnerId}`);
    return `${PREFIX}${String(row.employeeCodeSeq).padStart(3, '0')}`;
  }

  /**
   * Raise the counter to at least `n`, for a code somebody named by hand.
   *
   * Without this a partner who types `EMP-042` leaves the counter at 3, and
   * the allocator walks up to 42 months later and collides with it. Also a
   * single statement, so it cannot race the increment above.
   */
  async reserveUpTo(partnerId: string, code: string, db: Db = this.prisma): Promise<void> {
    const match = /^EMP-(\d+)$/.exec(code);
    if (!match) return; // Outside this namespace — the unique indexes still hold.
    const n = Number(match[1]);
    await db.$executeRaw`
      UPDATE "partners"
      SET "employeeCodeSeq" = GREATEST("employeeCodeSeq", ${n})
      WHERE "id" = ${partnerId}
    `;
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
