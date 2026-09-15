import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnerBranchQrStatus, PartnerStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { generateOpaqueToken } from '../../common/utils/crypto';

/**
 * A branch's own scan-to-pay identity — see `PartnerBranchQrCode`'s schema
 * docblock for why this extends the existing QR token pattern instead of
 * building a second QR system, and for why it is not `QrCode`/
 * `QrPaymentsService` itself.
 */
@Injectable()
export class PartnerBranchQrService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBranchBelongsToPartner(partnerId: string, branchId: string) {
    const branch = await this.prisma.partnerBranch.findUnique({ where: { id: branchId } });
    if (!branch || branch.partnerId !== partnerId) {
      throw new NotFoundException('Branch not found');
    }
  }

  getActive(partnerId: string, branchId: string) {
    return this.prisma.partnerBranchQrCode.findFirst({
      where: { partnerId, partnerBranchId: branchId, status: PartnerBranchQrStatus.ACTIVE },
    });
  }

  /** Throws if the branch already has an active code — use `rotate()` to replace one. */
  async issue(partnerId: string, branchId: string, issuedByUserId: string) {
    await this.assertBranchBelongsToPartner(partnerId, branchId);
    const existing = await this.getActive(partnerId, branchId);
    if (existing) {
      throw new BadRequestException('This branch already has an active QR code — rotate it instead');
    }
    return this.prisma.partnerBranchQrCode.create({
      data: {
        partnerId,
        partnerBranchId: branchId,
        token: generateOpaqueToken(24),
        issuedByUserId,
      },
    });
  }

  async revoke(partnerId: string, branchId: string, revokedByUserId: string) {
    const active = await this.getActive(partnerId, branchId);
    if (!active) throw new NotFoundException('This branch has no active QR code');
    return this.prisma.partnerBranchQrCode.update({
      where: { id: active.id },
      data: { status: PartnerBranchQrStatus.REVOKED, revokedAt: new Date(), revokedByUserId },
    });
  }

  /**
   * Revoke-then-issue as one atomic unit — never an update of the existing
   * row, so a revoked token can never become valid again by accident (see
   * the model's own docblock). Safe to call even with no active code yet.
   */
  async rotate(partnerId: string, branchId: string, actorUserId: string) {
    await this.assertBranchBelongsToPartner(partnerId, branchId);
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.partnerBranchQrCode.findFirst({
        where: { partnerId, partnerBranchId: branchId, status: PartnerBranchQrStatus.ACTIVE },
      });
      if (active) {
        await tx.partnerBranchQrCode.update({
          where: { id: active.id },
          data: { status: PartnerBranchQrStatus.REVOKED, revokedAt: new Date(), revokedByUserId: actorUserId },
        });
      }
      return tx.partnerBranchQrCode.create({
        data: {
          partnerId,
          partnerBranchId: branchId,
          token: generateOpaqueToken(24),
          issuedByUserId: actorUserId,
        },
      });
    });
  }

  /**
   * Customer-facing resolution — the only thing a scan ever learns. No
   * amount, no rate, no commercial data: just enough to know where the
   * purchase is about to happen, exactly like `partnerPayQr.ts`'s existing
   * plaintext payload, but now server-verified and revocable. A revoked or
   * unknown token, or a branch/partner that has since closed, all resolve
   * to the same 404 — this never falls back to treating the scan as a
   * general partner code.
   */
  async resolve(token: string) {
    const qr = await this.prisma.partnerBranchQrCode.findUnique({
      where: { token },
      include: { branch: true, partner: true },
    });
    if (!qr || qr.status !== PartnerBranchQrStatus.ACTIVE) {
      throw new NotFoundException('This QR code is not valid');
    }
    if (!qr.branch.isActive || qr.partner.status !== PartnerStatus.ACTIVE || !qr.partner.isActive) {
      throw new NotFoundException('This QR code is not valid');
    }
    return {
      partnerId: qr.partnerId,
      partnerBranchId: qr.partnerBranchId,
      partnerDisplayName: qr.partner.displayName,
      branchName: qr.branch.name,
    };
  }
}
