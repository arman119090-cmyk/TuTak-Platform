import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  NotificationKind,
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from '@cashout/contracts';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PUSH_TOKEN_DEAD } from './expo-push.adapter';
import { NotificationPort } from './notification.port';

const TOPIC = 'notification';
const MAX_ATTEMPTS = 5;

/** Which preference gates which kind. */
const PREFERENCE_FOR: Record<NotificationKind, keyof UpdateNotificationPreferencesDto> = {
  PAYOUT_COMPLETED: 'payoutStatus',
  PAYOUT_CANCELLED: 'payoutStatus',
  PAYOUT_REJECTED: 'payoutStatus',
  PAYOUT_UNDER_REVIEW: 'payoutStatus',
  AUTO_PAYOUT_CREATED: 'autoPayout',
  AUTO_PAYOUT_PAUSED: 'autoPayout',
  SECURITY_PIN_CHANGED: 'securityAlerts',
  SECURITY_BIOMETRIC_CHANGED: 'securityAlerts',
  SECURITY_NEW_DEVICE: 'securityAlerts',
  PARK_SWITCHED: 'parkChanges',
  PARK_ACCESS_CHANGED: 'parkChanges',
  DRIVER_ID_DECIDED: 'parkChanges',
};

/**
 * Notifications, through the outbox.
 *
 * A notification is enqueued as an outbox row — inside the same transaction as
 * the change it announces, when the caller has one — and delivered by the
 * sweeper. So a payout that completes is announced even if the process dies a
 * millisecond later, and never announced twice. Preferences are applied at
 * delivery time, so turning a category off applies to anything still queued.
 */
@Injectable()
export class NotificationService {
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly port: NotificationPort,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  // ----------------------------------------------------------- preferences

  async preferences(driverId: string): Promise<NotificationPreferencesDto> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { driverId } });
    return {
      payoutStatus: row?.payoutStatus ?? true,
      autoPayout: row?.autoPayout ?? true,
      securityAlerts: row?.securityAlerts ?? true,
      parkChanges: row?.parkChanges ?? true,
      pushRegistered: !!row?.pushToken,
      deliveryMode: this.port.mode,
    };
  }

  async updatePreferences(
    driverId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const before = await this.preferences(driverId);
    await this.prisma.notificationPreference.upsert({
      where: { driverId },
      create: { driverId, ...dto },
      update: dto,
    });
    await this.audit.record({
      action: 'notifications.preferences_updated',
      subjectType: 'driver',
      subjectId: driverId,
      actorType: 'DRIVER',
      before: {
        payoutStatus: before.payoutStatus,
        autoPayout: before.autoPayout,
        securityAlerts: before.securityAlerts,
        parkChanges: before.parkChanges,
      },
      after: dto,
    });
    return this.preferences(driverId);
  }

  async registerPushToken(driverId: string, token: string, platform: string): Promise<void> {
    await this.prisma.notificationPreference.upsert({
      where: { driverId },
      create: { driverId, pushToken: token, pushPlatform: platform, pushTokenAt: this.clock.now() },
      update: { pushToken: token, pushPlatform: platform, pushTokenAt: this.clock.now() },
    });
  }

  // ------------------------------------------------------------- enqueueing

  /** Queues a notification. Pass `tx` to make it part of the change it announces. */
  async enqueue(
    input: {
      driverId: string;
      kind: NotificationKind;
      payload?: Record<string, string | number | null>;
    },
    tx?: TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).outboxMessage.create({
      data: {
        topic: TOPIC,
        payload: {
          driverId: input.driverId,
          kind: input.kind,
          payload: input.payload ?? {},
        } as Prisma.InputJsonObject,
        availableAt: this.clock.now(),
      },
    });
  }

  // --------------------------------------------------------------- delivery

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      this.logger.fail('Notification delivery tick failed', error);
    } finally {
      this.running = false;
    }
  }

  /** Delivers everything due. Returns how many were handed to the port. */
  async drain(batchSize = 50): Promise<number> {
    const due = await this.prisma.outboxMessage.findMany({
      where: { topic: TOPIC, processedAt: null, availableAt: { lte: this.clock.now() } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let delivered = 0;
    for (const message of due) {
      const body = message.payload as {
        driverId: string;
        kind: NotificationKind;
        payload: Record<string, string | number | null>;
      };
      try {
        const sent = await this.deliver(body);
        if (sent) delivered += 1;
        await this.prisma.outboxMessage.update({
          where: { id: message.id },
          data: { processedAt: this.clock.now(), attempts: { increment: 1 } },
        });
      } catch (error) {
        const attempts = message.attempts + 1;
        await this.prisma.outboxMessage.update({
          where: { id: message.id },
          data: {
            attempts,
            lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
            ...(attempts >= MAX_ATTEMPTS
              ? { processedAt: this.clock.now() }
              : { availableAt: this.clock.plusSeconds(30 * attempts) }),
          },
        });
      }
    }
    return delivered;
  }

  private async deliver(body: {
    driverId: string;
    kind: NotificationKind;
    payload: Record<string, string | number | null>;
  }): Promise<boolean> {
    const preferences = await this.prisma.notificationPreference.findUnique({
      where: { driverId: body.driverId },
    });
    const gate = PREFERENCE_FOR[body.kind];
    if (preferences && preferences[gate] === false) return false;

    const driver = await this.prisma.driver.findUnique({
      where: { id: body.driverId },
      include: { user: { select: { locale: true } } },
    });
    if (!driver) return false;

    const result = await this.port.send({
      driverId: body.driverId,
      kind: body.kind,
      locale: driver.user.locale,
      pushToken: preferences?.pushToken ?? null,
      payload: body.payload,
    });
    if (!result.delivered) {
      if (result.reason === PUSH_TOKEN_DEAD) {
        // The device is gone: forget the token and stop retrying this message.
        await this.prisma.notificationPreference.updateMany({
          where: { driverId: body.driverId },
          data: { pushToken: null, pushPlatform: null, pushTokenAt: null },
        });
        return false;
      }
      throw new Error(`push not delivered: ${result.reason}`);
    }
    return true;
  }
}
