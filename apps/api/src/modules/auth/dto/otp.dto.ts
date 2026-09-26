import { IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import {
  ARMENIAN_PHONE_MESSAGE as PHONE_MESSAGE,
  ARMENIAN_PHONE_REGEX as PHONE_REGEX,
} from '../../../common/validators/armenian-phone';
import { PASSWORD_MAX, PASSWORD_MIN, PASSWORD_MIN_MESSAGE } from './password.dto';

export class RequestRegistrationOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;
}

/**
 * Name/email are optional here on purpose (item 3: "Name/email may be
 * optional later"). A placeholder name is filled in server-side when
 * omitted; the profile-update endpoint already lets the customer complete
 * it afterwards.
 */
export class VerifyRegistrationOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  /**
   * The password the customer chooses, and the only one this account will
   * ever have had.
   *
   * Required, and validated here rather than in the service, which is what
   * makes "no account without a password the customer knows" true rather
   * than intended: the global `ValidationPipe` runs before the handler, so a
   * request carrying a short password is refused *before* the code is
   * consumed. A rejected attempt therefore costs the customer a retry of the
   * password, never the SMS.
   *
   * Rules come from `password.dto.ts` so this endpoint cannot drift from
   * password reset and change-password. Never logged — see
   * `AuthService.verifyRegistrationOtp`.
   */
  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MIN_MESSAGE })
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  lastName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(['hy', 'ru', 'en'])
  locale?: string;

  /**
   * Spec: referral attribution may only ever be captured at registration,
   * and only here — there is no later endpoint that accepts one.
   */
  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class RequestLoginOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;
}

export class VerifyLoginOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: PHONE_MESSAGE })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
