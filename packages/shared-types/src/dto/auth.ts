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
