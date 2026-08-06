import { IsEnum, IsNumberString, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { QrCodeType } from '@prisma/client';

export class IssueQrDto {
  @IsEnum(QrCodeType)
  type: QrCodeType;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(30)
  @Max(86_400)
  expiresInSeconds?: number;
}
