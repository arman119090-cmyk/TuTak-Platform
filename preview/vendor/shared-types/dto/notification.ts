export type NotificationChannel = 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP';

export interface NotificationDto {
  id: string;
  userId: string;
  channel: NotificationChannel;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number> | null;
  isRead: boolean;
  createdAt: string;
}
