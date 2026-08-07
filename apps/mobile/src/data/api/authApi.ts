import type {
  AuthResponseDto,
  AuthTokensDto,
  ChangePasswordRequestDto,
  ConfirmPasswordResetRequestDto,
  ConfirmPhoneVerificationRequestDto,
  LoginRequestDto,
  RegisterRequestDto,
  RequestPasswordResetRequestDto,
  SuccessResponseDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const authApi = {
  async register(dto: RegisterRequestDto & { deviceId: string }) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/register', dto);
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

  async confirmPhoneVerification(dto: ConfirmPhoneVerificationRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<SuccessResponseDto>>(
      '/auth/verify-phone/confirm',
      dto,
    );
    return data.data;
  },
};
