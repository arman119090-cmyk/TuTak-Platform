import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

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

  async assignRole(dto: AssignRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw new NotFoundException('Role not found');

    return this.prisma.userRole.upsert({
      where: {
        userId_roleId_partnerId: {
          userId: dto.userId,
          roleId: role.id,
          partnerId: dto.partnerId ?? (null as unknown as string),
        },
      },
      update: {},
      create: { userId: dto.userId, roleId: role.id, partnerId: dto.partnerId },
    });
  }

  async revokeRole(userId: string, roleName: string, partnerId?: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: roleName as never } });
    return this.prisma.userRole.deleteMany({
      where: { userId, roleId: role.id, partnerId: partnerId ?? null },
    });
  }

  setActive(userId: string, isActive: boolean) {
    return this.prisma.user.update({ where: { id: userId }, data: { isActive } });
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
