/**
 * Outbound SMS.
 *
 * A port rather than a concrete vendor, because the choice of carrier is a
 * commercial decision that will change, and because verification codes must
 * not be coupled to whoever is cheapest in Armenia this quarter. The domain
 * asks for a message to reach a number; how that happens is configuration.
 */
export interface SmsProvider {
  /**
   * Delivers a message. Resolves on hand-off to the carrier — which is an
   * acknowledgement of acceptance, not of delivery to the handset. Rejects if
   * the carrier refuses it.
   */
  send(params: { to: string; body: string }): Promise<{ providerMessageId: string | null }>;

  /** Identifies the implementation in logs and health output. */
  readonly name: string;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
