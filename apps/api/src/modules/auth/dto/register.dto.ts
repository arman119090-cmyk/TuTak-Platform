import { IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { ARMENIAN_PHONE_MESSAGE, ARMENIAN_PHONE_REGEX } from '../../../common/validators/armenian-phone';

export class RegisterDto {
  @IsString()
  @Matches(ARMENIAN_PHONE_REGEX, { message: ARMENIAN_PHONE_MESSAGE })
  phone: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @IsString()
  @Length(1, 50)
  firstName: string;

  @IsString()
  @Length(1, 50)
  lastName: string;

  @IsOptional()
  @IsIn(['hy', 'ru', 'en'])
  locale?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
