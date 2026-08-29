import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class InitiateTopUpDto {
  @IsMoneyString({ allowZero: false })
  amount: string;

  /**
   * Optional, scoped per user by `IdempotencyService` — same reasoning as
   * every other money-moving endpoint (`StopSessionDto.idempotencyKey`,
   * `CapturePaymentParams.idempotencyKey`): without one, a client retrying a
   * request whose response was lost has no way to tell "already initiated"
   * from "never sent."
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
