import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class IssuePartnerApiKeyDto {
  @IsUUID()
  partnerId: string;

  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;
}
