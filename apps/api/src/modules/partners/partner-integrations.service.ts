import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, PartnerIntegrationStatus, PartnerIntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';

/**
 * Spec §3: the extension point for how a partner can accept payment or
 * connect a system, not a working implementation of every type. Only
 * `WEBSITE`'s own lifecycle (URL, verified-or-not) is modeled beyond the
 * generic `configuration` blob — see the schema comment on
 * `PartnerIntegration.websiteUrl` for why.
 */
@Injectable()
export class PartnerIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(partnerId: string) {
    return this.prisma.partnerIntegration.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(partnerId: string, dto: CreateIntegrationDto, actorUserId: string) {
    if (dto.type === PartnerIntegrationType.WEBSITE && !dto.websiteUrl) {
      throw new BadRequestException('websiteUrl is required for a WEBSITE integration');
    }

    if (dto.partnerBranchId) {
      const branch = await this.prisma.partnerBranch.findUnique({
        where: { id: dto.partnerBranchId },
      });
      if (!branch || branch.partnerId !== partnerId) {
        throw new BadRequestException('This branch does not belong to the given partner');
      }
    }

    const integration = await this.prisma.partnerIntegration.create({
      data: {
        partnerId,
        partnerBranchId: dto.partnerBranchId,
        type: dto.type,
        // Never trusted at creation — spec §3 is explicit that no URL a
        // partner enters is trusted until verified. WEBSITE starts at
        // PENDING_VERIFICATION rather than ACTIVE; every other type starts
        // NOT_CONNECTED, since nothing here has actually connected anything
        // yet — that is next session's work per the migration doc.
        status:
          dto.type === PartnerIntegrationType.WEBSITE
            ? PartnerIntegrationStatus.PENDING_VERIFICATION
            : PartnerIntegrationStatus.NOT_CONNECTED,
        websiteUrl: dto.type === PartnerIntegrationType.WEBSITE ? dto.websiteUrl : undefined,
        configuration: dto.configuration as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditService.record({
      actorUserId,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerIntegration',
      entityId: integration.id,
      metadata: { event: 'integration_created', partnerId, type: dto.type },
    });

    return integration;
  }

  /**
   * TODO: BUSINESS DECISION REQUIRED — the real verification method (DNS TXT
   * record, meta tag, file upload...) is not specified anywhere. This is
   * deliberately the only way a WEBSITE integration can reach ACTIVE: a
   * platform admin attesting to it by hand, not an automatic check. Replace
   * the body of this method, not its shape, once the method is decided —
   * everything that reads `PartnerIntegrationStatus.ACTIVE` downstream stays
   * correct either way.
   *
   * Audited deliberately: this is the one human trust decision in the whole
   * extension point (spec §3 says no partner-supplied URL is ever
   * auto-trusted), so which admin attested to which URL, and when, has to
   * be on the record.
   */
  async markWebsiteVerified(partnerId: string, integrationId: string, actorUserId: string) {
    // GitHub issue #28 (MEDIUM, 2026-08-16): this used to update any
    // integration by id straight to ACTIVE with no type check. An
    // API/POS/EV_CHARGING/OCPI row — none of which have any real
    // activation path or specification — could be flipped ACTIVE by
    // calling this endpoint with its id, which is dangerous the moment
    // anything downstream starts trusting ACTIVE as permission to
    // auto-finalize a transaction (see the integrated-partner
    // auto-finalization policy recorded on `PurchaseIntentsService`).
    const existing = await this.prisma.partnerIntegration.findUnique({
      where: { id: integrationId },
    });
    if (!existing) {
      throw new BadRequestException('Integration not found');
    }
    // Launch-readiness audit (2026-08-16): the route is
    // `partners/:partnerId/integrations/:integrationId/verify-website`, but
    // this method never checked that `integrationId` actually belongs to
    // `partnerId` — the same `dto.partnerBranchId` mismatch this file
    // already guards against in `create()`. Not currently reachable by
    // anyone but a platform admin (who may act on any partner regardless),
    // so no live privilege escalation existed, but a wrong id in the URL
    // silently activated a *different* partner's integration instead of
    // failing — worth closing as the route's own authorization surface, not
    // just its type surface.
    if (existing.partnerId !== partnerId) {
      throw new BadRequestException('This integration does not belong to the given partner');
    }
    if (existing.type !== PartnerIntegrationType.WEBSITE) {
      throw new BadRequestException(
        'Only a WEBSITE integration can be activated through website verification',
      );
    }

    const integration = await this.prisma.partnerIntegration.update({
      where: { id: integrationId },
      data: { status: PartnerIntegrationStatus.ACTIVE, websiteVerifiedAt: new Date() },
    });

    await this.auditService.record({
      actorUserId,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'PartnerIntegration',
      entityId: integration.id,
      metadata: { event: 'website_verified', partnerId: integration.partnerId, websiteUrl: integration.websiteUrl },
    });

    return integration;
  }
}
