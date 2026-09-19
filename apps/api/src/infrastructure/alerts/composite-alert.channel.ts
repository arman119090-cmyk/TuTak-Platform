import { Alert, AlertChannel, AlertDelivery } from './alert-channel.interface';

/**
 * Fans one alert out to several receivers and reports the honest aggregate:
 * delivered if at least one receiver accepted it, with every receiver's own
 * word kept in `detail` so `alert:verify` can say which one failed.
 *
 * Channels are sent in parallel and a throwing channel counts as not
 * delivered rather than taking the others down with it.
 */
export class CompositeAlertChannel implements AlertChannel {
  readonly name: string;

  constructor(private readonly channels: readonly AlertChannel[]) {
    this.name = channels.map((c) => c.name).join('+');
  }

  async send(alert: Alert): Promise<AlertDelivery> {
    const results = await Promise.all(
      this.channels.map(async (channel) => {
        try {
          const delivery = await channel.send(alert);
          return { channel: channel.name, ...delivery };
        } catch (err) {
          return {
            channel: channel.name,
            delivered: false,
            detail: `channel threw: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }),
    );
    return {
      delivered: results.some((r) => r.delivered),
      detail: results.map((r) => `${r.channel}: ${r.detail}`).join('; '),
    };
  }
}
