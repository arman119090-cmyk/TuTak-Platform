/**
 * Sends one clearly-labelled test alert and exits — the controlled way to
 * prove that `ALERT_WEBHOOK_URL` actually reaches a human.
 *
 * The counterpart of `sentry-verify.ts`, and it exists for the same reason:
 * an alerting channel nobody has ever sent a message through is a channel
 * that works right up until the first time it matters. `AlertsModule` warns
 * loudly when the URL is unset, but a URL that is *set and wrong* — a typo,
 * a revoked Telegram bot token, a Slack webhook whose channel was archived —
 * looks identical to a working one in every log this platform writes.
 *
 * ## Why this one does not refuse in production
 *
 * `sentry-verify.ts` refuses outright in production, and is right to: it
 * throws a synthetic exception, and a production error tracker should never
 * contain errors somebody manufactured.
 *
 * This is the opposite case. The webhook has to be proved *in production*,
 * because that is the deployment whose silence would cost something, and
 * because the URL is a per-environment variable — proving it on staging
 * proves nothing about the one that pages you at three in the morning. The
 * message is unmistakably a test in its title, its body and its `kind`
 * context field, so nobody reading it at three in the morning has to work
 * out whether it is real.
 *
 * ## Why it goes through `AlertsService` rather than the channel
 *
 * The channel alone would prove that `fetch` reaches the URL. The thing an
 * operator needs to know is that the *whole* path works — including the
 * Redis suppression window, which is where a misconfigured `REDIS_URL`
 * would silently swallow every alert after the first. So this sends the way
 * production sends.
 *
 * The suppression key carries a timestamp, so running this twice in a row
 * sends twice. A verification tool that silently did nothing on its second
 * run would teach exactly the wrong lesson.
 *
 * Usage: `pnpm --filter @tutak/api alert:verify`
 */
import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ALERT_CHANNEL, AlertChannel } from '../infrastructure/alerts/alert-channel.interface';
import { AlertsModule } from '../infrastructure/alerts/alerts.module';
import { AlertsService } from '../infrastructure/alerts/alerts.service';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { resolveAppEnvironment } from '../config/app-environment';
import configuration from '../config/configuration';
import { validate } from '../config/env.validation';

/**
 * The smallest thing that can send a real alert.
 *
 * Deliberately not `AppModule`. This script is meant to be run against
 * production — that is the whole point, the webhook is a per-environment
 * variable — and booting the entire application to send one message also
 * starts the sweep scheduler, the queue workers and a Prisma pool. Measured:
 * it worked, and then a background sweep raced the shutdown and printed a
 * Prisma error on top of the one result the operator was reading.
 *
 * `AlertsModule` needs exactly two things, and they are both here: the
 * configuration it reads `alerts.webhookUrl` and `appEnv` from, and the
 * Redis client `AlertsService` suppresses repeats with. Nothing about the
 * path being verified is stubbed by leaving the rest out.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    RedisModule,
    AlertsModule,
  ],
})
class AlertVerifyModule {}

export interface AlertVerifyResult {
  sent: boolean;
  channel: string;
  reason: string;
}

/**
 * The alert itself.
 *
 * Severity `warning`, not `critical`: a test that pages the on-call rotation
 * is a test people stop running.
 */
export function buildVerificationAlert(now: Date) {
  return {
    severity: 'warning' as const,
    title: 'TuTak alert channel test',
    body:
      'This is a test of the alerting channel, sent by hand with alert:verify. ' +
      'Nothing is wrong. If you are seeing this, the webhook works and real ' +
      'alerts — reconciliation discrepancies, dead-lettered outbox events, ' +
      'failed background jobs — will reach you the same way.',
    // Timestamped so a second run is not swallowed by the suppression
    // window. Every real alert key is stable on purpose; this one must not
    // be, for the opposite reason.
    key: `alert-verify:${now.toISOString()}`,
    context: {
      kind: 'alert-verify',
      sentAt: now.toISOString(),
    },
  };
}

export async function runAlertVerify(
  alerts: AlertsService,
  channel: AlertChannel,
  now = new Date(),
): Promise<AlertVerifyResult> {
  const sent = await alerts.fire(buildVerificationAlert(now));

  if (!sent) {
    // `fire` swallows transport errors by design — see the interface — so a
    // false here means the suppression window claimed it, which with a
    // timestamped key means Redis returned something unexpected rather than
    // that the alert was a duplicate.
    return {
      sent: false,
      channel: channel.name,
      reason:
        'AlertsService reported the alert was not sent. With a timestamped key that ' +
        'should be impossible unless Redis is unreachable — check REDIS_URL.',
    };
  }

  if (channel.name === 'console') {
    return {
      sent: false,
      channel: channel.name,
      reason:
        'ALERT_WEBHOOK_URL is not set, so the alert went to the console and no human was ' +
        'told. Set it on this service and run this again.',
    };
  }

  return { sent: true, channel: channel.name, reason: `sent at ${now.toISOString()}` };
}

async function main() {
  const appEnv = resolveAppEnvironment(process.env);
  // `error` so the bootstrap chatter of a whole Nest application does not
  // bury the one line this script exists to print.
  const app = await NestFactory.createApplicationContext(AlertVerifyModule, {
    logger: ['error'],
  });

  try {
    const result = await runAlertVerify(
      app.get(AlertsService),
      app.get<AlertChannel>(ALERT_CHANNEL),
    );

    if (!result.sent) {
      console.error(result.reason);
      process.exitCode = 1;
      return;
    }

    console.log(`Sent through the ${result.channel} channel (${result.reason}).`);
    console.log(`Environment reported in the message: ${appEnv}.`);
    console.log('Look for "TuTak alert channel test" wherever ALERT_WEBHOOK_URL points.');
    console.log('If it did not arrive, the URL is wrong or the receiver rejected it —');
    console.log('the channel logs the status code it got back.');
  } catch (err) {
    new Logger('alert-verify').error(err);
    process.exitCode = 1;
  } finally {
    /*
     * Shut down, but do not wait forever for it.
     *
     * Redis keeps its connection open past `close()`, and that keeps the
     * event loop alive — measured: the script printed every line it should
     * and then sat there until killed. An operator reading a correct result
     * in a terminal that will not come back has been told the alert works
     * and shown something that looks broken.
     *
     * Two seconds is enough for the shutdown hooks that matter (the alert
     * itself was already awaited and delivered before this point), and the
     * explicit exit is what a one-shot CLI owes its caller.
     */
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
    ]);
    process.exit(process.exitCode ?? 0);
  }
}

// Only runs the side-effecting entry point when executed directly, not when
// a test imports the exports above — same guard as `sentry-verify.ts`.
if (require.main === module) {
  void main();
}
