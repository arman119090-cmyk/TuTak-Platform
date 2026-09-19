export const ALERT_CHANNEL = Symbol('ALERT_CHANNEL');

export type AlertSeverity = 'critical' | 'warning';

export interface Alert {
  severity: AlertSeverity;
  /** Short, human-first. Appears as the notification's headline. */
  title: string;
  /** One or two sentences saying what happened and what it means. */
  body: string;
  /**
   * Stable identity for this *kind* of alert, e.g. `outbox.dead-letter`.
   * Used to suppress repeats — see `AlertsService`.
   */
  key: string;
  /** Anything an operator would otherwise have to go and look up. */
  context?: Record<string, string | number>;
}

/**
 * Somewhere an alert can be delivered.
 *
 * `send` must never reject. An alert is what fires when something has already
 * gone wrong; if delivering it could throw, the failure would propagate back
 * into the very code path that was reporting a problem — turning a
 * reconciliation discrepancy into a crashed reconciliation run, and losing
 * both the finding and the alert. Implementations swallow their own transport
 * errors and log them — and *report* them in the returned `AlertDelivery`,
 * because swallowing them silently is how the first webhook channel let
 * `alert:verify` certify a receiver that had answered 500.
 */
/**
 * What became of one alert at the channel.
 *
 * `delivered` means the receiver *accepted* it — a 2xx from the webhook —
 * never that the platform tried. The console channel therefore always
 * answers `false`: a log line in a container nobody is attached to is
 * exactly the state the webhook exists to replace.
 */
export interface AlertDelivery {
  delivered: boolean;
  /** Human-readable: the status code, the transport error, or what happened instead. */
  detail: string;
}

export interface AlertChannel {
  send(alert: Alert): Promise<AlertDelivery>;
  /** Named in startup logs so it is obvious which channel is live. */
  readonly name: string;
}
