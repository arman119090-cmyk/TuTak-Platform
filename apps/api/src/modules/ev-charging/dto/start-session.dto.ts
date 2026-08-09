import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class StartSessionDto {
  @IsUUID()
  connectorId: string;

  @IsOptional()
  @IsUUID()
  reservationId?: string;
}

export class StopSessionDto {
  @IsOptional()
  @IsMoneyString()
  bonusAmountToApply?: string;

  /**
   * Optional, and optional on purpose.
   *
   * Concurrent stops are already safe — the session is claimed before any
   * money moves — but a client whose request timed out while the server was
   * still working cannot tell "your charge went through" from "your charge
   * failed": it gets the same refusal either way. With a key, the retry gets
   * the original result back.
   *
   * Not required on the wire, so a client that predates the key is exactly
   * as safe as it was before. The mobile app now always sends one, derived
   * from the session rather than the clock so that it survives the app being
   * killed between the timeout and the retry.
   */
  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}

export class MeterValueDto {
  @IsMoneyString()
  energyKwh: string;
}
