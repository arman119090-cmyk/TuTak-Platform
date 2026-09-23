import { ReconciliationOutcome } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateSettlementDraftDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;
}

export class MarkReadyDto {
  @IsString()
  @Length(0, 100)
  @IsOptional()
  documentNumber?: string;

  @IsDateString()
  @IsOptional()
  documentDate?: string;

  @IsString()
  @Length(0, 200)
  @IsOptional()
  documentReference?: string;
}

export class RecordTransferDto {
  /** The bank's own reference. Unique per currency across every settlement. */
  @IsString()
  @Length(1, 200)
  bankTransferReference: string;
}

export class TransferFailedDto {
  @IsString()
  @Length(3, 500)
  reason: string;

  @IsString()
  @Length(0, 200)
  @IsOptional()
  bankTransferReference?: string;
}

export class ProposeSettlementReconciliationDto {
  @IsEnum(ReconciliationOutcome)
  outcome: ReconciliationOutcome;

  /** A statement line, a wire reference, a bank's case id. Mandatory. */
  @IsString()
  @Length(3, 1000)
  evidence: string;

  /** Required when the outcome is MONEY_MOVED. */
  @IsString()
  @Length(0, 200)
  @IsOptional()
  bankTransferReference?: string;
}

export class ReportTransferProblemDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class CancelSettlementDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

/**
 * The filter on a partner's own account activity.
 *
 * Every field is optional and the unfiltered call is the whole account, so a
 * partner never has to guess a starting filter to see their own money. The
 * cursor is opaque on purpose: it encodes the sort key, and a client that
 * built one itself would be relying on an ordering this service is free to
 * change.
 */
export class PartnerActivityQueryDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsIn(['UNSETTLED', 'IN_SETTLEMENT', 'UNDER_REVIEW', 'PAID'])
  @IsOptional()
  state?: 'UNSETTLED' | 'IN_SETTLEMENT' | 'UNDER_REVIEW' | 'PAID';

  @IsString()
  @Length(1, 400)
  @IsOptional()
  cursor?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
