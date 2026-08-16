import { BadRequestException, Injectable } from '@nestjs/common';
import { PartnerIntegrationStatus, PartnerIntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  list(partnerId: string) {
    return this.prisma.partnerIntegration.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(partnerId: string, dto: CreateIntegrationDto) {
    if (dto.type === PartnerIntegrationType.WEBSITE && !dto.websiteUrl) {
      throw new BadRequestException('websiteUrl is required for a WEBSITE integration');
    }

    return this.prisma.partnerIntegration.create({
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
  }

  /**
   * TODO: BUSINESS DECISION REQUIRED — the real verification method (DNS TXT
   * record, meta tag, file upload...) is not specified anywhere. This is
   * deliberately the only way a WEBSITE integration can reach ACTIVE: a
   * platform admin attesting to it by hand, not an automatic check. Replace
   * the body of this method, not its shape, once the method is decided —
   * everything that reads `PartnerIntegrationStatus.ACTIVE` downstream stays
   * correct either way.
   */
  markWebsiteVerified(integrationId: string) {
    return this.prisma.partnerIntegration.update({
      where: { id: integrationId },
      data: { status: PartnerIntegrationStatus.ACTIVE, websiteVerifiedAt: new Date() },
    });
  }
}
