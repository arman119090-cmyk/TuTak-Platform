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
  [RoleName.PARTNER_OWNER]: 2,
  [RoleName.ADMIN]: 3,
  [RoleName.SUPER_ADMIN]: 4,
};

/** Roles that are meaningless without a partner, and roles that reject one. */
const PARTNER_SCOPED_ROLES: RoleName[] = [RoleName.PARTNER_STAFF, RoleName.PARTNER_OWNER];

function rankOf(user: RequestUser): number {
  return user.roles.reduce((highest, role) => Math.max(highest, ROLE_RANK[role] ?? 0), -1);
}

function assertMayGrant(granter: RequestUser, role: RoleName): void {
  if (rankOf(granter) < ROLE_RANK[role]) {
    throw new ForbiddenException(`You cannot grant or revoke the ${role} role`);
  }
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
  async setActive(userId: string, isActive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { isActive } });
      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return user;
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
