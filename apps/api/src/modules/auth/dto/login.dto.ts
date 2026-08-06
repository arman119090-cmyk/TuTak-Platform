import { IsOptional, IsString, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^\+374\d{8}$/, { message: 'phone must be an Armenian number in +374XXXXXXXX format' })
  phone: string;

  @IsString()
  password: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
