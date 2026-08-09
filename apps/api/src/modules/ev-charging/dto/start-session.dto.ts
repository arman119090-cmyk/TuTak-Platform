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
   * Not required, because the shipped mobile app does not send one and
   * making it mandatory would break every installed copy. A client that
   * sends one gets the stronger guarantee; one that does not is exactly as
   * safe as before.
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
