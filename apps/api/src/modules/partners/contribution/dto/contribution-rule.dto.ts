import { ContributionRuleKind, UnitOfMeasure } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Terms somebody is asking for. Approving them is a different request by a
 * different person — see `PartnerContributionRuleService`.
 *
 * No `actorId`: the maker is whoever is signed in. A body field for it would
 * let one person propose in another's name, which would make the maker and
 * the checker the same person wearing two hats.
 */
export class ProposeContributionRuleDto {
  @IsEnum(ContributionRuleKind)
  kind: ContributionRuleKind;

  /** PERCENT_BPS and HYBRID. Not on the 50-point grid: this is the contract. */
  @IsInt()
  @Min(0)
  @Max(10_000)
  @IsOptional()
  percentBps?: number;

  /** FIXED_PER_UNIT and HYBRID. 10 for HAZE. */
  @IsNumberString()
  @IsOptional()
  fixedPerUnit?: string;

  @IsEnum(UnitOfMeasure)
  @IsOptional()
  unit?: UnitOfMeasure;

  @IsString()
  @Length(0, 500)
  @IsOptional()
  note?: string;
}

export class DecideContributionRuleDto {
  @IsString()
  @Length(0, 500)
  @IsOptional()
  note?: string;
}

export class RejectContributionRuleDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}
