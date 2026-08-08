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
 * errors and log them.
 */
export interface AlertChannel {
  send(alert: Alert): Promise<void>;
  /** Named in startup logs so it is obvious which channel is live. */
  readonly name: string;
}
