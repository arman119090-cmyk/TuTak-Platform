import type { AuthResponseDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const authApi = {
  async login(phone: string, password: string, deviceId: string) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/login', {
      phone,
      password,
      deviceId,
    });
    return data.data;
  },
  async logout(deviceId: string) {
    await httpClient.post('/auth/logout', { deviceId });
  },
};
