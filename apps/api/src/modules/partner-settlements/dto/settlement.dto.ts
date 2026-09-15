import { ReconciliationOutcome } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';

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
