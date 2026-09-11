import { IsString, Length, Matches, MinLength } from 'class-validator';
import { ARMENIAN_PHONE_MESSAGE, ARMENIAN_PHONE_REGEX } from '../../../common/validators/armenian-phone';

/**
 * Password rules live here rather than being repeated at each call site.
 * The upper bound matters as much as the lower one: argon2 hashes whatever it
 * is handed, so an unbounded password is a cheap way to burn CPU.
 *
 * These are duplicated in `@tutak/shared-types` as `PASSWORD_MIN_LENGTH` /
 * `PASSWORD_MAX_LENGTH`, which is what the app enforces — and the duplication
 * is forced rather than chosen: this package's `rootDir` deliberately forbids
 * importing TypeScript source from outside `apps/api/src`, the same constraint
 * that makes it keep its own copy of the Sentry sanitiser.
 *
 * A copy nothing checks is a copy that drifts, and drifting here has a
 * specific cost: a form that does not know the server's limit lets the
 * customer type something the server will reject, and then has to explain a
 * refusal it could have prevented. `password-rules-parity.spec.ts` reads both
 * and fails the build the moment they disagree.
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
