import { Role } from '../enums/roles';

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

export interface RefreshRequestDto {
  refreshToken: string;
  deviceId: string;
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
