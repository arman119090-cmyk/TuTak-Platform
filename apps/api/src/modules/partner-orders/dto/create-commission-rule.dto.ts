import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/** Spec §19: a configurable commission rule — never a hardcoded per-partner percentage. */
export class CreateCommissionRuleDto {
  /** Null = platform-wide default rule. */
  @IsUUID()
  @IsOptional()
  partnerId?: string | null;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @Length(1, 200)
  name: string;

  @IsInt()
  @Min(0)
  @Max(10_000)
  rateBps: number;
}
