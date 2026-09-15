import { IsOptional, IsString, Matches } from 'class-validator';
import { ARMENIAN_PHONE_MESSAGE, ARMENIAN_PHONE_REGEX } from '../../../common/validators/armenian-phone';

export class LoginDto {
  @IsString()
  @Matches(ARMENIAN_PHONE_REGEX, { message: ARMENIAN_PHONE_MESSAGE })
  phone: string;

  @IsString()
  password: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
