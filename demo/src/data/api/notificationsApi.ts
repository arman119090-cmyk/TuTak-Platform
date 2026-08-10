import type { NotificationDto, PaginatedResultDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const notificationsApi = {
  async myNotifications(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<NotificationDto>>>(
      '/notifications/me',
      { params: { cursor } },
    );
    return data.data;
  },

  async markRead(id: string) {
    await httpClient.post(`/notifications/${id}/read`);
  },

  async markAllRead() {
    await httpClient.post('/notifications/read-all');
  },

  /**
   * Registers this device for push. No user id in the body — the server
   * takes it from the token, so a device can only ever be attached to the
   * account that is signed in.
   */
  async registerPushToken(dto: {
    deviceId: string;
    platform: 'IOS' | 'ANDROID';
    pushToken: string;
    deviceName?: string;
  }) {
    await httpClient.post('/notifications/push-token', dto);
  },
};
