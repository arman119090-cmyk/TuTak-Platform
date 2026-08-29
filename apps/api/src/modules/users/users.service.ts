import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditAction, MediaAsset, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaViewService } from '../media/media-view.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/types/request-user.type';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaViewService,
    private readonly audit: AuditService,
  ) {}

  findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Like findById, but never includes passwordHash — safe to return over HTTP. */
  async findSafeById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isPhoneVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        avatarConsentReferralList: true,
        personalizedRecommendationsConsent: true,
        avatarAsset: true,
      },
    });
    return user && this.withAvatar(user);
  }

  /**
   * Replaces the joined `MediaAsset` row with a delivery-safe, signed
   * reference to it.
   *
   * The row itself carries storage keys, and spec §3.3 says those never reach
   * a client. The URL is signed to this user because it is their own avatar —
   * `GET /users/me` is the only route that returns it, and the only person who
   * can call it for a given account is that account.
   */
  private withAvatar<
    T extends {
      id: string;
      avatarAsset: MediaAsset | null;
      avatarConsentReferralList: boolean;
      personalizedRecommendationsConsent: boolean;
    },
  >(user: T) {
    const { avatarAsset, avatarConsentReferralList, personalizedRecommendationsConsent, ...rest } = user;
    return {
      ...rest,
      avatar: this.media.signedImage(avatarAsset, user.id),
      showAvatarInReferralList: avatarConsentReferralList,
      personalizedRecommendationsEnabled: personalizedRecommendationsConsent,
    };
  }

  async createCustomer(
    data: {
      phone: string;
      email?: string;
      passwordHash: string;
      firstName: string;
      lastName: string;
      locale: string;
      isPhoneVerified?: boolean;
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

  /**
   * Builds the JWT claim set: flattened roles, permissions, partner scopes.
   *
   * Also the enforcement point for account state. Previously this only
   * checked existence, so deactivating or locking an account had no effect
   * until its access token expired — an administrator responding to fraud
   * pressed "Deactivate" and the attacker kept working (audit §B4).
   */
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
    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Account is no longer active');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    const roles = new Set<RoleName>();
    const permissions = new Set<string>();
    const partnerScopes: Record<string, string[]> = {};
    const allBranchPartnerIds = new Set<string>();

    for (const userRole of user.roles) {
      roles.add(userRole.role.name);
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.name);
      }
      if (userRole.partnerId) {
        partnerScopes[userRole.role.name] ??= [];
        partnerScopes[userRole.role.name]!.push(userRole.partnerId);
        if (userRole.allBranches) {
          allBranchPartnerIds.add(userRole.partnerId);
        }
      }
    }

    // Fuel-station branches task: recomputed on every request, same as
    // everything else in this method, so a branch deactivation takes effect
    // immediately rather than at next login.
    const branchAssignments = await this.prisma.partnerBranchStaffAssignment.findMany({
      where: { userId, isActive: true },
      select: { partnerBranchId: true },
    });

    return {
      id: user.id,
      phone: user.phone,
      roles: Array.from(roles),
      permissions: Array.from(permissions) as RequestUser['permissions'],
      partnerScopes,
      branchIds: branchAssignments.map((a) => a.partnerBranchId),
      allBranchPartnerIds: Array.from(allBranchPartnerIds),
      mustChangePassword: user.mustChangePassword,
    };
  }

  async updateProfile(
    userId: string,
    data: Partial<{ firstName: string; lastName: string; email: string; locale: string }>,
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isPhoneVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        avatarConsentReferralList: true,
        personalizedRecommendationsConsent: true,
        avatarAsset: true,
      },
    });
    return this.withAvatar(user);
  }

  /**
   * Turn nearby-partner personalisation on or off — spec: "как ты думаешь
   * это правильно или нет" (Arman, 2026-08-26), answered by scoping this to
   * an explicit, off-by-default opt-in rather than silent profiling. Mirrors
   * `MediaService.setAvatarConsent`'s shape: a plain flag flip, audited
   * because it is a consent decision, nothing cached or derived stored
   * anywhere beyond the flag itself.
   */
  async setPersonalizationConsent(
    userId: string,
    consent: boolean,
    actor: { userId: string; ipAddress: string | null; userAgent: string | null },
  ): Promise<{ personalizedRecommendationsEnabled: boolean }> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { personalizedRecommendationsConsent: consent },
      select: { personalizedRecommendationsConsent: true },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: AuditAction.PERSONALIZATION_CONSENT_CHANGED,
      entityType: 'User',
      entityId: userId,
      metadata: { personalizedRecommendationsEnabled: updated.personalizedRecommendationsConsent },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { personalizedRecommendationsEnabled: updated.personalizedRecommendationsConsent };
  }

  /**
   * Counts a failed attempt and locks the account once the threshold is hit.
   *
   * The counter is cleared at the same moment the lock is applied. Leaving it
   * at or above the threshold meant that once an account had ever been locked,
   * a single further mistake after the lock expired re-locked it immediately —
   * an effectively permanent lockout that any stranger could trigger against a
   * known phone number (docs/AUDIT_2026-08-B.md §H10).
   */
  async registerFailedLogin(userId: string, lockThreshold = 5, lockMinutes = 15) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });

    if (user.failedLoginCount >= lockThreshold) {
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + lockMinutes * 60_000),
          failedLoginCount: 0,
        },
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
