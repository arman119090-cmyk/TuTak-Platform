import { IsEnum, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';
import { Type } from 'class-transformer';
import { QrCodeType } from '@prisma/client';

export class IssueQrDto {
  @IsEnum(QrCodeType)
  type: QrCodeType;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsMoneyString({ allowZero: false })
  amount?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(30)
  @Max(86_400)
  expiresInSeconds?: number;
}
