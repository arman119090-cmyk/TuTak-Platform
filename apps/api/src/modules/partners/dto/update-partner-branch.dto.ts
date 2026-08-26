import { IsLatitude, IsLongitude, IsOptional, IsString, Length } from 'class-validator';

/** All fields optional: a partner editing one detail of an existing branch need not resend the rest. */
export class UpdatePartnerBranchDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
