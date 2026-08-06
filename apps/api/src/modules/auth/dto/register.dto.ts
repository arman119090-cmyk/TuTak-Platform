import { IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Matches(/^\+374\d{8}$/, { message: 'phone must be an Armenian number in +374XXXXXXXX format' })
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
