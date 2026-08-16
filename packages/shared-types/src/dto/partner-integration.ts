import { PartnerIntegrationStatus, PartnerIntegrationType } from '../enums/partner-integration';

export interface PartnerIntegrationDto {
  id: string;
  partnerId: string;
  partnerBranchId: string | null;
  type: PartnerIntegrationType;
  status: PartnerIntegrationStatus;
  configuration: Record<string, unknown> | null;
  websiteUrl: string | null;
  websiteVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerIntegrationRequestDto {
  type: PartnerIntegrationType;
  partnerBranchId?: string;
  /** WEBSITE only; ignored for every other type. */
  websiteUrl?: string;
  configuration?: Record<string, unknown>;
}
