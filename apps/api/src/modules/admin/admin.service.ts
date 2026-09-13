import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/request-user.type';
import { AssignRoleDto } from './dto/assign-role.dto';

/**
 * Privilege ordering. A grant is permitted only up to the granter's own rank,
 * so no path exists from a lesser role to a greater one.
 */
const ROLE_RANK: Record<RoleName, number> = {
  [RoleName.CUSTOMER]: 0,
  [RoleName.PARTNER_STAFF]: 1,
  [RoleName.PARTNER_MANAGER]: 2,
  [RoleName.PARTNER_OWNER]: 3,
  [RoleName.ADMIN]: 4,
  [RoleName.SUPER_ADMIN]: 5,
};

/** Roles that are meaningless without a partner, and roles that reject one. */
const PARTNER_SCOPED_ROLES: RoleName[] = [
  RoleName.PARTNER_STAFF,
  RoleName.PARTNER_MANAGER,
  RoleName.PARTNER_OWNER,
];

function rankOf(user: RequestUser): number {
  return user.roles.reduce((highest, role) => Math.max(highest, ROLE_RANK[role] ?? 0), -1);
}

function assertMayGrant(granter: RequestUser, role: RoleName): void {
  if (rankOf(granter) < ROLE_RANK[role]) {
    throw new ForbiddenException(`You cannot grant or revoke the ${role} role`);
  }
}

/**
 * The highest rank a *stored* user holds, from their role rows.
 *
 * `rankOf` reads a `RequestUser`, which only exists for the caller. Acting on
 * somebody else means reading their roles from the database, and this is the
 * shape those come back in.
 */
function rankOfRoles(roles: readonly RoleName[]): number {
  return roles.reduce((highest, role) => Math.max(highest, ROLE_RANK[role] ?? 0), -1);
}

/**
 * What an administrator may see of another account.
 *
 * `setActive` used to return the whole Prisma `User`, which carries
 * `passwordHash`. An administrator is not an attacker, but a password hash
 * that travels is a password hash that gets logged by a proxy, cached by a
 * browser, and pasted into a ticket — and offline cracking does not care
 * which of those it came from. Nothing any caller needed was in the fields
 * left out.
 */
function toAdminUserView(user: {
  id: string;
  phone: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  isPhoneVerified: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isPhoneVerified: user.isPhoneVerified,
    createdAt: user.createdAt,
  };
}

function assertScopingMatchesRole(role: RoleName, partnerId?: string): void {
  const needsPartner = PARTNER_SCOPED_ROLES.includes(role);
  if (needsPartner && !partnerId) {
    throw new ForbiddenException(`The ${role} role requires a partnerId`);
  }
  if (!needsPartner && partnerId) {
    throw new ForbiddenException(`The ${role} role cannot be scoped to a partner`);
  }
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: CursorPaginationQueryDto) {
    const items = await this.prisma.user.findMany({
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      // Explicit select — never let passwordHash leave the server boundary.
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isPhoneVerified: true,
        isActive: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        roles: { include: { role: true } },
        wallet: true,
      },
    });
    return { items, nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  /**
   * Grants a role.
   *
   * The controller only checks that the caller holds USER_MANAGE, which ADMIN
   * has — so before these guards an ADMIN could call this with
   * `{ userId: <self>, role: SUPER_ADMIN }` and take the platform in one
   * request, including WALLET_WRITE for unlimited manual credits
   * (docs/AUDIT_2026-08-B.md §C6). Three rules close that:
   *
   *  1. Nobody may change their own roles. Self-escalation is never
   *     legitimate, and it defeats an audit trail whose whole value is
   *     recording who granted what to whom.
   *  2. Nobody may grant a role ranked above their own.
   *  3. A role's scoping must match its kind, so the partner-scope checks
   *     elsewhere never have to interpret a nonsensical grant.
   */
  async assignRole(dto: AssignRoleDto, granter: RequestUser) {
    if (dto.userId === granter.id) {
      throw new ForbiddenException('You cannot change your own roles');
    }
    assertMayGrant(granter, dto.role);
    assertScopingMatchesRole(dto.role, dto.partnerId);

    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw new NotFoundException('Role not found');

    // Global roles carry partnerId = NULL, which Prisma disallows inside a
    // compound unique lookup, so this is a find-then-create rather than an
    // upsert. Idempotent: re-granting an existing role is a no-op.
    const existing = await this.prisma.userRole.findFirst({
      where: { userId: dto.userId, roleId: role.id, partnerId: dto.partnerId ?? null },
    });
    if (existing) return existing;

    return this.prisma.userRole.create({
      data: { userId: dto.userId, roleId: role.id, partnerId: dto.partnerId },
    });
  }

  async revokeRole(
    userId: string,
    roleName: RoleName,
    partnerId: string | undefined,
    granter: RequestUser,
  ) {
    if (userId === granter.id) {
      throw new ForbiddenException('You cannot change your own roles');
    }
    assertMayGrant(granter, roleName);

    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: roleName } });

    // Removing the last SUPER_ADMIN locks every operator out of the platform
    // with no way back in through the product.
    if (roleName === RoleName.SUPER_ADMIN) {
      const remaining = await this.prisma.userRole.count({
        where: { roleId: role.id, userId: { not: userId } },
      });
      if (remaining === 0) {
        throw new ForbiddenException('Cannot revoke the last SUPER_ADMIN');
      }
    }

    return this.prisma.userRole.deleteMany({
      where: { userId, roleId: role.id, partnerId: partnerId ?? null },
    });
  }

  /**
   * Deactivation must end the session, not just flag the row: revoking the
   * refresh tokens stops the account being silently resurrected at the next
   * refresh, while the isActive check in buildRequestUserClaims kills the
   * current access token on its very next request.
   */
  async setActive(userId: string, isActive: boolean, admin: RequestUser) {
    // Same three protections `revokeRole` has always had, and for the same
    // reason: disabling an account is not a smaller act than removing a role
    // from it. It ends every session and locks the person out of the
    // platform entirely, which is *more* than revoking one role does.
    // Matches the controller's own check rather than widening it: an
    // administrator re-enabling themselves is impossible anyway (a disabled
    // account has no session), and the one that matters is locking yourself
    // out. Kept here too because a guard that only exists in a controller is
    // a guard the next caller does not get.
    if (userId === admin.id && !isActive) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw new NotFoundException('User not found');

    const targetRoles = target.roles.map((assignment) => assignment.role.name);
    if (rankOf(admin) < rankOfRoles(targetRoles)) {
      // Without this an ADMIN could disable a SUPER_ADMIN — every session
      // ended, no way back in through the product — which is precisely the
      // escalation the rank ordering exists to prevent, reached through a
      // different door.
      throw new ForbiddenException('You cannot change the state of an account ranked above you');
    }

    // Disabling the last SUPER_ADMIN locks every operator out of the
    // platform with no way back in, exactly as revoking the last one would.
    if (!isActive && targetRoles.includes(RoleName.SUPER_ADMIN)) {
      const superAdminRole = await this.prisma.role.findUniqueOrThrow({
        where: { name: RoleName.SUPER_ADMIN },
      });
      const remaining = await this.prisma.userRole.count({
        where: {
          roleId: superAdminRole.id,
          userId: { not: userId },
          user: { isActive: true },
        },
      });
      if (remaining === 0) {
        throw new ForbiddenException('Cannot disable the last active SUPER_ADMIN');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { isActive } });
      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return toAdminUserView(user);
    });
  }

  async systemOverview() {
    const [userCount, partnerCount, transactionCount, activeBonusTotal] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.partner.count(),
      this.prisma.transaction.count(),
      this.prisma.wallet.aggregate({ _sum: { availableBonus: true, pendingBonus: true, reservedBonus: true } }),
    ]);

    return {
      userCount,
      partnerCount,
      transactionCount,
      totalAvailableBonus: activeBonusTotal._sum.availableBonus?.toString() ?? '0',
      totalPendingBonus: activeBonusTotal._sum.pendingBonus?.toString() ?? '0',
      totalReservedBonus: activeBonusTotal._sum.reservedBonus?.toString() ?? '0',
    };
  }
}
