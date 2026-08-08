import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PUSH_PROVIDER,
  PushMessage,
  PushProvider,
} from '../../infrastructure/push/push-provider.interface';

export interface DispatchParams {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string | number>;
}

/**
 * Sends a notification to every device a user has registered.
 *
 * Sits between the notification domain and the push port so that neither
 * knows about the other's problem: the domain does not know a user has
 * devices, and the provider does not know what a user is.
 *
 * Never throws. Everything that triggers a notification here — a payment
 * completing, an account being created — has already happened and been
 * committed; failing the caller because a phone could not be reached would
 * turn a successful payment into an error the customer sees.
 */
@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async dispatch(params: DispatchParams): Promise<void> {
    try {
      const devices = await this.prisma.device.findMany({
        where: { userId: params.userId, pushToken: { not: null } },
        select: { id: true, pushToken: true },
      });
      if (devices.length === 0) return;

      // One user, several devices, and the same token can legitimately
      // appear twice — a phone reinstalled under a new device id keeps its
      // token. Sending twice would show the notification twice.
      const byToken = new Map<string, string[]>();
      for (const device of devices) {
        const token = device.pushToken!;
        byToken.set(token, [...(byToken.get(token) ?? []), device.id]);
      }

      const messages: PushMessage[] = [...byToken.keys()].map((to) => ({
        to,
        title: params.title,
        body: params.body,
        data: params.data,
      }));

      const result = await this.push.send(messages);
      await this.forgetInvalidTokens(result.invalidTokens, byToken);
    } catch (err) {
      this.logger.error(`Push dispatch failed for user ${params.userId}`, err as Error);
    }
  }

  /**
   * A token the service reports as dead belongs to an app that was deleted
   * or reinstalled. Keeping it means every future batch carries a message
   * that cannot arrive, so the row is cleared — the device itself is kept,
   * because it is also the session record.
   */
  private async forgetInvalidTokens(
    invalidTokens: string[],
    byToken: Map<string, string[]>,
  ): Promise<void> {
    const deviceIds = invalidTokens.flatMap((token) => byToken.get(token) ?? []);
    if (deviceIds.length === 0) return;

    await this.prisma.device.updateMany({
      where: { id: { in: deviceIds } },
      data: { pushToken: null },
    });
    this.logger.log(`Cleared ${deviceIds.length} push token(s) the service rejected`);
  }
}
