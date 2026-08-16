import { IsString, Length } from 'class-validator';

export class RejectPartnerDto {
  @IsString()
  @Length(1, 500)
  reason: string;
}
