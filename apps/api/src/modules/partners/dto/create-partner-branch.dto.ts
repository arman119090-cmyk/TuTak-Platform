import { IsLatitude, IsLongitude, IsString, Length } from 'class-validator';

/** A partner adding one of their own physical locations — spec: partner self-service branches. */
export class CreatePartnerBranchDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsString()
  @Length(1, 300)
  address: string;

  @IsString()
  @Length(1, 100)
  city: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
