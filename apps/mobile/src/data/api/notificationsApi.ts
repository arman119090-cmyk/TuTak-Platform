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
};
