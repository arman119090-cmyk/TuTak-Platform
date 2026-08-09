import type {
  AuthResponseDto,
  AuthTokensDto,
  ChangePasswordRequestDto,
  ConfirmPasswordResetRequestDto,
  ConfirmPhoneVerificationRequestDto,
  DeleteAccountRequestDto,
  DeleteAccountResponseDto,
  LoginRequestDto,
  RegisterRequestDto,
  RequestPasswordResetRequestDto,
  SuccessResponseDto,
} from '@tutak/shared-types';
import { healthUrl, httpClient, ApiEnvelope } from './httpClient';

export const authApi = {
  async register(dto: RegisterRequestDto & { deviceId: string }) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/register', dto);
    return data.data;
  },

  /**
   * Whether the API this build points at is a demonstration.
   *
   * Asked of the server rather than decided by the app: a build is not
   * inherently a demo, the deployment it talks to is. The same APK aimed at a
   * real API shows no demo entry at all.
   */
  async isDemoDeployment(): Promise<boolean> {
    try {
      // Absolute, because health is not under the version prefix the
      // client's base URL carries. See `healthUrl`.
      const { data } = await httpClient.get<{ demoMode?: boolean }>(healthUrl);
      return data?.demoMode === true;
    } catch {
      // Unreachable, older, or not a demo — either way, no shortcut.
      return false;
    }
  },

  /** Signs in as the seeded demo customer. Only exists on a demo deployment. */
  async demoSession(deviceId: string) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/demo-session', {
      deviceId,
    });
    return data.data;
  },

  async login(dto: LoginRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/login', dto);
    return data.data;
  },

  async logout(deviceId: string) {
    await httpClient.post('/auth/logout', { deviceId });
  },

  async refresh(refreshToken: string, deviceId: string) {
    const { data } = await httpClient.post<ApiEnvelope<{ tokens: AuthTokensDto }>>(
      '/auth/refresh',
      { refreshToken, deviceId },
    );
    return data.data.tokens;
  },

  async changePassword(dto: ChangePasswordRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/change-password',
      dto,
    );
    return data.data;
  },

  async requestPasswordReset(dto: RequestPasswordResetRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/password-reset/request',
      dto,
    );
    return data.data;
  },

  async confirmPasswordReset(dto: ConfirmPasswordResetRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/password-reset/confirm',
      dto,
    );
    return data.data;
  },

  async requestPhoneVerification() {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/verify-phone/request',
    );
    return data.data;
  },

  /**
   * Deletes this account.
   *
   * The response carries the date the personal data is erased, which the
   * confirmation screen shows verbatim — access ends now, erasure is later,
   * and telling the customer only the first half would be misleading.
   */
  async deleteAccount(dto: DeleteAccountRequestDto) {
    const { data } = await httpClient.delete<ApiEnvelope<DeleteAccountResponseDto>>('/users/me', {
      data: dto,
    });
    return data.data;
  },

  async confirmPhoneVerification(dto: ConfirmPhoneVerificationRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/verify-phone/confirm',
      dto,
    );
    return data.data;
  },
};
