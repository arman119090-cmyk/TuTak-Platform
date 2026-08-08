import { IsDateString, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class RecordAcquirerSettlementDto {
  @IsMoneyString({ allowZero: false })
  amount: string;

  /**
   * The acquirer's own reference for the transfer, copied from the
   * remittance advice. Unique in the database, so two operators working from
   * the same email cannot enter it twice.
   */
  @IsString()
  @Length(1, 200)
  reference: string;

  /** The day the money landed per the statement, not when it was keyed in. */
  @IsDateString()
  settledOn: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
