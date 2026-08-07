import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class CapturePaymentDto {
  @IsUUID()
  partnerId: string;

  @IsMoneyString({ allowZero: false })
  amount: string;

  /**
   * A tokenized payment method from the client SDK — never a raw card
   * number. Nothing downstream of here ever sees a PAN, which is what keeps
   * the platform out of PCI scope.
   */
  @IsString()
  @Length(1, 200)
  sourceToken: string;

  /**
   * Required, not optional. A payment endpoint without an idempotency key is
   * a double-charge waiting for a flaky network.
   */
  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}

export class SearchPaymentsDto {
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(['CAPTURED', 'DECLINED'])
  status?: 'CAPTURED' | 'DECLINED';

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class RefundPaymentDto {
  @IsUUID()
  paymentId: string;

  /** Omit for a full refund of whatever remains unrefunded. */
  @IsOptional()
  @IsMoneyString({ allowZero: false })
  amount?: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}
