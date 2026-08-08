import { Injectable } from '@nestjs/common';
import { DevicePlatform, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { PushDispatchService } from './push-dispatch.service';

export interface SendNotificationParams {
  userId: string;
  channel?: NotificationChannel;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string | number>;
  /**
   * Text for the phone's lock screen. The persisted row stores translation
   * keys so the app can render in the user's current language, but a push
   * notification is composed by the server and cannot be re-rendered later,
   * so it needs the words themselves. Omit to persist only.
   */
  push?: { title: string; body: string };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushDispatch: PushDispatchService,
  ) {}

  /**
   * Records the notification and, when the caller supplied push text,
   * delivers it to the user's devices.
   *
   * The row is written first and always: it is the in-app inbox and the
   * audit record, and it must exist whether or not a phone was reachable.
   * Delivery follows and cannot fail this call — see PushDispatchService.
   */
  async send(params: SendNotificationParams) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        channel: params.channel ?? NotificationChannel.IN_APP,
        titleKey: params.titleKey,
        bodyKey: params.bodyKey,
        params: (params.params ?? undefined) as Prisma.InputJsonValue,
      },
    });

    if (params.push) {
      await this.pushDispatch.dispatch({
        userId: params.userId,
        title: params.push.title,
        body: params.push.body,
        data: { notificationId: notification.id },
      });
    }

    return notification;
  }

  /**
   * Records the token this device will receive notifications on.
   *
   * Upserted against `(userId, deviceId)`, so reinstalling the app replaces
   * the token rather than accumulating dead ones — and so a device belonging
   * to one account can never be updated by another, which is what would let
   * someone redirect a stranger's notifications to their own phone.
   */
  registerPushToken(params: {
    userId: string;
    deviceId: string;
    platform: DevicePlatform;
    pushToken: string;
    deviceName?: string;
  }) {
    return this.prisma.device.upsert({
      where: { userId_deviceId: { userId: params.userId, deviceId: params.deviceId } },
      update: {
        pushToken: params.pushToken,
        platform: params.platform,
        deviceName: params.deviceName,
        lastSeenAt: new Date(),
      },
      create: {
        userId: params.userId,
        deviceId: params.deviceId,
        platform: params.platform,
        pushToken: params.pushToken,
        deviceName: params.deviceName,
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
