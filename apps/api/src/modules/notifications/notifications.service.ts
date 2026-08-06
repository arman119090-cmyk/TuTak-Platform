import { Injectable } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';

export interface SendNotificationParams {
  userId: string;
  channel?: NotificationChannel;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string | number>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  send(params: SendNotificationParams) {
    // IN_APP is always persisted; PUSH/SMS/EMAIL delivery would be dispatched
    // to a provider (FCM/APNs, SMS gateway, mailer) here in addition to the
    // persisted row — the row itself is the in-app inbox / audit record.
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        channel: params.channel ?? NotificationChannel.IN_APP,
        titleKey: params.titleKey,
        bodyKey: params.bodyKey,
        params: (params.params ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async listMine(userId: string, query: CursorPaginationQueryDto) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return { items, nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
