import { IsString, Length } from 'class-validator';

/** Spec §27: only before handover, only OWNER/MANAGER, always with a reason. */
export class CorrectExternalPaymentDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}
