import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequestUser } from '../auth/types/request-user.type';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createCustomer(
    data: {
      phone: string;
      email?: string;
      passwordHash: string;
      firstName: string;
      lastName: string;
      locale: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const customerRole = await client.role.findUniqueOrThrow({
      where: { name: RoleName.CUSTOMER },
    });

    return client.user.create({
      data: {
        ...data,
        wallet: { create: {} },
        roles: { create: { roleId: customerRole.id } },
      },
    });
  }

  /** Builds the JWT claim set: flattened roles, permissions, and partner scopes. */
  async buildRequestUserClaims(userId: string): Promise<Omit<RequestUser, 'deviceId'>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = new Set<RoleName>();
    const permissions = new Set<string>();
    const partnerScopes: Record<string, string[]> = {};

    for (const userRole of user.roles) {
      roles.add(userRole.role.name);
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.name);
      }
      if (userRole.partnerId) {
        partnerScopes[userRole.role.name] ??= [];
        partnerScopes[userRole.role.name]!.push(userRole.partnerId);
      }
    }

    return {
      id: user.id,
      phone: user.phone,
      roles: Array.from(roles),
      permissions: Array.from(permissions) as RequestUser['permissions'],
      partnerScopes,
    };
  }

  async updateProfile(
    userId: string,
    data: Partial<{ firstName: string; lastName: string; email: string; locale: string }>,
  ) {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async registerFailedLogin(userId: string, lockThreshold = 5, lockMinutes = 15) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });

    if (user.failedLoginCount >= lockThreshold) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) },
      });
    }
    return user;
  }

  resetFailedLogins(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }
}
