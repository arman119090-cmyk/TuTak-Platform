import { IsString, Length, Matches, MinLength } from 'class-validator';
import { ARMENIAN_PHONE_MESSAGE, ARMENIAN_PHONE_REGEX } from '../../../common/validators/armenian-phone';

/**
 * Password rules live here rather than being repeated at each call site.
 * The upper bound matters as much as the lower one: argon2 hashes whatever it
 * is handed, so an unbounded password is a cheap way to burn CPU.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * The one sentence every endpoint that takes a password says when it is too
 * short. Exported with the bounds so a new caller cannot invent a second,
 * differently-worded rule for the same requirement — which is exactly what
 * happened when OTP registration grew a password of its own.
 */
export const PASSWORD_MIN_MESSAGE = `password must be at least ${PASSWORD_MIN} characters`;

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MIN_MESSAGE })
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  newPassword: string;
}

export class RequestPasswordResetDto {
  @IsString()
  @Matches(ARMENIAN_PHONE_REGEX, { message: ARMENIAN_PHONE_MESSAGE })
  phone: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @Matches(ARMENIAN_PHONE_REGEX, { message: ARMENIAN_PHONE_MESSAGE })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MIN_MESSAGE })
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  newPassword: string;
}

export class ConfirmPhoneDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
