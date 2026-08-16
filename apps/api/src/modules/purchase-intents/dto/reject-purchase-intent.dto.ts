import { IsOptional, IsString, Length } from 'class-validator';

export class RejectPurchaseIntentDto {
  /** Spec §26: structured quick reasons plus an optional custom comment. */
  @IsString()
  @Length(1, 100)
  reasonCode: string;

  @IsString()
  @Length(0, 500)
  @IsOptional()
  comment?: string;
}
