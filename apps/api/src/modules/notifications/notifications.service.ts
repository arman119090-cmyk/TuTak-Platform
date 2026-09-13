import { Injectable, Logger } from '@nestjs/common';
import { DevicePlatform, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { PushDispatchService } from './push-dispatch.service';

/**
 * Parameter names a notification may never carry.
 *
 * Lower-cased and matched exactly. A denylist is the weaker shape and is
 * used here on purpose: `params` is an open map whose legitimate keys differ
 * per template (amounts, partner names, dates), so an allowlist would have
 * to be maintained alongside every new template and would fail closed on the
 * harmless ones. Both known leaks are closed at their own call sites; this
 * catches the next one.
 */
const NEVER_IN_A_NOTIFICATION = new Set([
  'code',
  'otp',
  'pin',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
]);

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
  private readonly logger = new Logger(NotificationsService.name);

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
        params: this.withoutSecrets(params.params) as Prisma.InputJsonValue,
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
   * Drops anything that must never be readable through the inbox.
   *
   * A notification row is returned in full by `listMine()` to anyone holding
   * a session for the account. A password-reset code stored here turned a
   * session into a password reset; a phone-verification code stored here
   * defeated phone verification outright, because the entire point of that
   * code is to prove control of the *number*, and a code readable in-app
   * proves nothing.
   *
   * Both call sites have stopped sending one. This is the second lock, at
   * the only place every notification passes through: a future caller that
   * puts a secret in `params` loses it here rather than publishing it, and
   * the log line says so loudly enough to be found.
   *
   * Dropping rather than refusing is deliberate. Refusing would fail the
   * request a customer is waiting on — and the notification is not the part
   * that matters, the SMS is.
   */
  private withoutSecrets(params: SendNotificationParams['params']) {
    if (!params || typeof params !== 'object') return params ?? undefined;

    const kept: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (NEVER_IN_A_NOTIFICATION.has(key.toLowerCase())) dropped.push(key);
      else kept[key] = value;
    }

    if (dropped.length > 0) {
      this.logger.error(
        `Refused to store ${dropped.join(', ')} in a notification: the inbox is readable by ` +
          'anyone holding a session for this account. Send the secret by SMS and nowhere else.',
      );
    }
    return kept as SendNotificationParams['params'];
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
