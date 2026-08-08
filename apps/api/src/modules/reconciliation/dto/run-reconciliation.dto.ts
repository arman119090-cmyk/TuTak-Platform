import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class PartnerPayableStatementDto {
  @IsUUID()
  partnerId: string;

  /** What the bank says is owed, as a positive amount. */
  @IsMoneyString()
  amount: string;
}

export class RunReconciliationDto {
  /** The day being reconciled. Normalized to UTC midnight by the service. */
  @IsDateString()
  periodStart: string;

  /** The acquirer's reported receivable. Omit to run internal checks only. */
  @IsOptional()
  @IsMoneyString()
  pspReceivable?: string;

  /**
   * What the platform's own bank statement says. Omit until acquirer
   * settlements are being recorded — before that this account carries
   * payouts out with nothing in, and would report drift by construction.
   */
  @IsOptional()
  @IsMoneyString()
  platformBank?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartnerPayableStatementDto)
  partnerPayables?: PartnerPayableStatementDto[];
}
