import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** A `Prisma.TransactionClient` or the client itself — either can run these. */
type Db = Prisma.TransactionClient | PrismaService;

const PREFIX = 'EMP-';

/**
 * One posting on an employee card, as the partner's panel draws it.
 *
 * `deactivatedAt` is carried rather than inferred from `isActive`, because a
 * card that says "no longer here" without saying since when is the answer to
 * a different question than the one somebody reading last quarter's receipt
 * is asking.
 */
export interface PartnerEmployeeCardAssignment {
  branchId: string;
  branchName: string;
  branchAddress: string;
  role: string;
  isActive: boolean;
  assignedAt: string;
  deactivatedAt: string | null;
}

/**
 * Who a permanent employee code belongs to, mirroring
 * `PartnerEmployeeCardDto` in `@tutak/shared-types`.
 *
 * Restated here rather than imported: this package's build cannot reach
 * across the workspace (TS6059), the same constraint `media.contracts.ts`
 * lives under, so the two are kept in step by a contract test.
 *
 * No phone, no email, no user id — see `cardFor`.
 */
export interface PartnerEmployeeCard {
  code: string;
  firstName: string;
  lastName: string;
  /** Only the postings this caller may see; may be empty. */
  assignments: PartnerEmployeeCardAssignment[];
  /** Partner-scoped roles, including an all-branch grant that has no posting. */
  roles: { role: string; allBranches: boolean }[];
}

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

    // Two different collisions can fire on the insert below, and they need
    // opposite answers.
    //
    // If *this person* was given a code by a concurrent request, the right
    // answer is that code — re-read and return it. If the *number* we drew
    // was taken, the right answer is to draw again: the counter is
    // authoritative but not alone in the namespace. A hand-picked
    // `EMP-042` on an assignment claims a number the counter has not reached,
    // and during a rolling deploy the previous release is still issuing
    // codes by reading the highest one and adding one, which lands on the
    // number the counter is about to hand out.
    //
    // Bounded, because a loop that never gives up on a unique violation
    // turns a misconfiguration into a hung request. Three draws past a
    // contended number is already far beyond what a rollout window
    // produces.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const code = await this.nextCode(partnerId, db);
      try {
        const created = await db.partnerEmployee.create({
          data: { partnerId, userId, code },
          select: { code: true },
        });
        return created.code;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err;
        }
        const won = await db.partnerEmployee.findUnique({
          where: { partnerId_userId: { partnerId, userId } },
          select: { code: true },
        });
        if (won) return won.code;
        // The number was taken, not the person. Round again.
      }
    }
    throw new ConflictException(
      'Could not allocate an employee code for this partner — please retry.',
    );
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
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [row] = await db.$queryRaw<{ employeeCodeSeq: number }[]>`
        UPDATE "partners"
        SET "employeeCodeSeq" = "employeeCodeSeq" + 1
        WHERE "id" = ${partnerId}
        RETURNING "employeeCodeSeq"
      `;
      if (!row) throw new Error(`No such partner: ${partnerId}`);
      const code = `${PREFIX}${String(row.employeeCodeSeq).padStart(3, '0')}`;
      if (!(await this.isTaken(partnerId, code, db))) return code;
    }
    throw new ConflictException(
      'Could not allocate an employee code for this partner — please retry.',
    );
  }

  /**
   * Is this number already in use anywhere in the partner's `EMP-` namespace?
   *
   * The namespace spans two tables and the database does not know that: each
   * has its own unique index, so `EMP-003` can be one person's permanent code
   * and another person's posting code at the same time without either index
   * objecting. Nothing inside this service produces that — it draws every
   * number from one counter — but a writer outside it does, and one is
   * guaranteed to exist for the length of every rolling deploy, because the
   * release being replaced issues posting codes by reading the highest one
   * and adding one.
   *
   * Checking after the draw rather than instead of it. The counter is still
   * what makes two concurrent callers take different numbers; this only skips
   * the numbers somebody took without asking it.
   */
  private async isTaken(partnerId: string, code: string, db: Db): Promise<boolean> {
    const [employee, assignment] = await Promise.all([
      db.partnerEmployee.findUnique({
        where: { partnerId_code: { partnerId, code } },
        select: { id: true },
      }),
      db.partnerBranchStaffAssignment.findFirst({
        where: { partnerId, employeeDisplayCode: code },
        select: { id: true },
      }),
    ]);
    return Boolean(employee || assignment);
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
   * Who a code belongs to, within one partner.
   *
   * The lookup itself, unnarrowed: `cardFor` is what an endpoint calls,
   * because a code belonging to this partner is not the same question as a
   * code this particular caller is allowed to resolve.
   *
   * Partner-scoped by its key rather than by a filter somebody has to
   * remember to pass — `partnerId_code` is the unique index, so a code from
   * another organisation cannot be resolved here at all, whatever the caller
   * types.
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

  /**
   * The employee card as a caller at this partner may see it.
   *
   * Partner scope alone is not the answer. `listForPartner` was narrowed for
   * exactly this reason: a cashier posted to one branch could read another
   * branch's roster — names, phone numbers and codes — from an endpoint
   * whose sibling refused precisely that. Handing the same cashier a lookup
   * from `EMP-007` to a name would reopen it in a form that is easier to
   * enumerate, not harder.
   *
   * So a caller who does not see every branch resolves a code on one of two
   * grounds, both of which are things they can already see:
   *
   *   * the person is posted to a branch the caller is posted to, which is
   *     what the roster already tells them; or
   *   * the person confirmed a purchase at such a branch, which is what the
   *     purchase list already tells them — the code is on the row.
   *
   * The second ground is not a loosening. It is what makes an owner
   * resolvable: an owner or an all-branch manager confirms sales without
   * being posted anywhere, so on the first ground alone the one person a
   * cashier most often reads on a receipt would come back "no such
   * employee".
   *
   * Anything else is `null`, which the controller turns into a 404 rather
   * than a 403: "this code is not yours to resolve" and "there is no such
   * code" must look identical, or the difference between them is an
   * enumeration oracle.
   *
   * What comes back is deliberately narrow — the person's name, the
   * postings the caller may see, and the roles. No phone, no email, no user
   * id: a partner checking who confirmed a sale needs a name and a place,
   * not a way to reach somebody through the platform's records.
   */
  async cardFor(
    partnerId: string,
    code: string,
    branchIds: string[] | null = null,
  ): Promise<PartnerEmployeeCard | null> {
    const found = await this.byCode(partnerId, code);
    if (!found) return null;

    const { employee, assignments, roles } = found;
    const visible =
      branchIds === null
        ? assignments
        : assignments.filter((a) => branchIds.includes(a.branch.id));

    if (branchIds !== null && visible.length === 0) {
      const confirmedHere = await this.prisma.purchaseIntent.count({
        where: {
          partnerId,
          confirmedByEmployeeCode: code,
          partnerBranchId: { in: branchIds },
        },
      });
      if (confirmedHere === 0) return null;
    }

    return {
      code: employee.code,
      firstName: employee.user.firstName,
      lastName: employee.user.lastName,
      assignments: visible.map((a) => ({
        branchId: a.branch.id,
        branchName: a.branch.name,
        branchAddress: a.branch.address,
        role: a.role,
        isActive: a.isActive,
        assignedAt: a.createdAt.toISOString(),
        deactivatedAt: a.deactivatedAt?.toISOString() ?? null,
      })),
      roles: roles.map((r) => ({ role: r.role.name, allBranches: r.allBranches })),
    };
  }

  /**
   * The partner's people, as the "Employees" page lists them.
   *
   * A list of *people*, not of postings. The roster endpoint already returns
   * assignments, and a person posted to two branches appears twice there —
   * correct for "who works at this branch", wrong for "who works here".
   * This is the other question, and the permanent code is the thing that
   * makes it answerable.
   *
   * Narrowed the same way a single card is: a caller who does not see every
   * branch sees the people posted to the branches they see, and nobody
   * else. An owner sees everyone, including the people with no posting at
   * all — themselves, usually.
   */
  async listFor(partnerId: string, branchIds: string[] | null = null) {
    const employees = await this.prisma.partnerEmployee.findMany({
      where: {
        partnerId,
        ...(branchIds === null
          ? {}
          : {
              user: {
                branchStaffAssignments: {
                  some: { partnerId, partnerBranchId: { in: branchIds }, isActive: true },
                },
              },
            }),
      },
      orderBy: { code: 'asc' },
      select: {
        code: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (employees.length === 0) return [];

    const userIds = employees.map((employee) => employee.user.id);
    const [assignments, roles] = await Promise.all([
      this.prisma.partnerBranchStaffAssignment.findMany({
        where: {
          partnerId,
          userId: { in: userIds },
          isActive: true,
          ...(branchIds === null ? {} : { partnerBranchId: { in: branchIds } }),
        },
        select: { userId: true, role: true, branch: { select: { id: true, name: true } } },
      }),
      this.prisma.userRole.findMany({
        where: { partnerId, userId: { in: userIds } },
        select: { userId: true, allBranches: true, role: { select: { name: true } } },
      }),
    ]);

    return employees.map((employee) => ({
      code: employee.code,
      firstName: employee.user.firstName,
      lastName: employee.user.lastName,
      branches: assignments
        .filter((a) => a.userId === employee.user.id)
        .map((a) => ({ branchId: a.branch.id, branchName: a.branch.name, role: a.role })),
      roles: roles
        .filter((r) => r.userId === employee.user.id)
        .map((r) => ({ role: r.role.name, allBranches: r.allBranches })),
    }));
  }
}
