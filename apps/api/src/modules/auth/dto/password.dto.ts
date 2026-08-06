import { IsString, Length, Matches, MinLength } from 'class-validator';

/**
 * Password rules live here rather than being repeated at each call site.
 * The upper bound matters as much as the lower one: argon2 hashes whatever it
 * is handed, so an unbounded password is a cheap way to burn CPU.
 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` })
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  newPassword: string;
}

export class RequestPasswordResetDto {
  @IsString()
  @Matches(/^\+374\d{8}$/, { message: 'phone must be an Armenian number in +374XXXXXXXX format' })
  phone: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @Matches(/^\+374\d{8}$/, { message: 'phone must be an Armenian number in +374XXXXXXXX format' })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` })
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  newPassword: string;
}
