import type {
  AuthResponseDto,
  AuthTokensDto,
  LoginRequestDto,
  RegisterRequestDto,
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
};
