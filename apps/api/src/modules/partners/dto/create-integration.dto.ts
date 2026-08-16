import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PartnerIntegrationType } from '@prisma/client';

export class CreateIntegrationDto {
  @IsEnum(PartnerIntegrationType)
  type: PartnerIntegrationType;

  @IsUUID()
  @IsOptional()
  partnerBranchId?: string;

  /** WEBSITE only; ignored for every other type. */
  @IsString()
  @Length(3, 2000)
  @IsOptional()
  websiteUrl?: string;

  @IsObject()
  @IsOptional()
  configuration?: Record<string, unknown>;
}
