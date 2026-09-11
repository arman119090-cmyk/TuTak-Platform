import { Role } from '../enums/roles';
import type { MediaImageDto } from './media';

/**
 * What a password has to be, for every client and for the API.
 *
 * Here rather than in either of them because both enforce it and they must
 * agree: the API refuses a password outside these bounds, and a form that does
 * not know the same numbers lets the customer type something the server will
 * reject — then has to explain a refusal it could have prevented. That is
 * exactly how a password-length error ended up being shown against the SMS
 * code field.
 *
 * The upper bound matters as much as the lower one: argon2 hashes whatever it
 * is handed, so an unbounded password is a cheap way to burn server CPU.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface RegisterRequestDto {
  phone: string;
  email?: string;
  password: string;
  firstName: string;
  lastName: string;
  locale: string;
  referralCode?: string;
}

export interface LoginRequestDto {
  phone: string;
  password: string;
  deviceId: string;
  deviceName?: string;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface AuthenticatedUserDto {
  id: string;
  phone: string;
  email: string | null;
  firstName: string;
  lastName: string;
  roles: Role[];
  /** Partner IDs a scoped role (e.g. PARTNER_OWNER) applies to, keyed by role name. */
  partnerScopes: Record<string, string[]>;
  locale: string;
  isPhoneVerified: boolean;
  /**
   * This customer's own avatar, or null — spec §4: "the authenticated user's
   * own profile returns `avatar`". Signed and short-lived; it is theirs and
   * nobody else's to fetch.
   */
  avatar: MediaImageDto | null;
  /**
   * Whether they have agreed to their avatar appearing in their direct
   * referrer's Level-1 list. Default false. Returned so the Profile screen's
   * toggle can render the truth rather than an optimistic guess.
   */
  showAvatarInReferralList: boolean;
  /**
   * Whether this customer opted in to nearby partners being ranked by their
   * own purchase history. Default false — behavioural personalisation is
   * off until the customer turns it on, same posture as
   * `showAvatarInReferralList` above. Returned so Settings can render the
   * truth rather than an optimistic guess.
   */
  personalizedRecommendationsEnabled: boolean;
}

export interface AuthResponseDto {
  user: AuthenticatedUserDto;
  tokens: AuthTokensDto;
}

/** Every auth mutation that has no richer payload returns this shape. */
export interface SuccessResponseDto {
  success: boolean;
}

export interface ChangePasswordRequestDto {
  currentPassword: string;
  newPassword: string;
}

export interface RequestPasswordResetRequestDto {
  phone: string;
}

export interface ConfirmPasswordResetRequestDto {
  phone: string;
  code: string;
  newPassword: string;
}

export interface ConfirmPhoneVerificationRequestDto {
  code: string;
}

// ── OTP-first registration/login ──────────────────────────────────────────

export interface RequestRegistrationOtpRequestDto {
  phone: string;
}

export interface VerifyRegistrationOtpRequestDto {
  phone: string;
  code: string;
  /**
   * The password the customer chooses, sent with the code that proves the
   * number. Required: an account is never created without one, so no account
   * exists whose password its owner does not know.
   *
   * The confirmation field a form shows next to it is a client-side check and
   * is deliberately not here — there is nothing for the server to do with a
   * second copy of the same string.
   */
  password: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  locale?: string;
  referralCode?: string;
  deviceId: string;
  deviceName?: string;
}

export interface RequestLoginOtpRequestDto {
  phone: string;
}

export interface VerifyLoginOtpRequestDto {
  phone: string;
  code: string;
  deviceId: string;
  deviceName?: string;
}

/**
 * Deleting your own account.
 *
 * The password is re-entered because the access token is a fifteen-minute
 * bearer credential, and this is the one action a customer cannot undo.
 */
export interface DeleteAccountRequestDto {
  password: string;
}

export interface DeleteAccountResponseDto {
  /** When access ended — immediately, from the customer's point of view. */
  deletedAt: string;
  /**
   * When the personal data will be erased. Shown to the customer verbatim,
   * because "deleted" and "erased" happening a month apart is exactly the
   * kind of thing a privacy notice has to state rather than imply.
   */
  anonymizedAfter: string;
}
