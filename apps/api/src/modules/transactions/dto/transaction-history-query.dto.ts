import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { CursorPaginationQueryDto } from '../../../common/dto/pagination.dto';

export class TransactionHistoryQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
