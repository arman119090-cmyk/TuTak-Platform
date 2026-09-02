/**
 * Outbound SMS.
 *
 * A port rather than a concrete vendor, because the choice of carrier is a
 * commercial decision that will change, and because verification codes must
 * not be coupled to whoever is cheapest in Armenia this quarter. The domain
 * asks for a message to reach a number; how that happens is configuration.
 */
export interface SmsMessage {
  to: string;
  /**
   * The rendered text, for carriers that accept text.
   *
   * Always populated, and always the whole message — it is what a person
   * reads, and what the console transport prints in development.
   */
  body: string;
  /**
   * The variable parts of the message, for carriers that do not accept text.
   *
   * Viva's Business Hub does not: a send names a template registered in the
   * Viva profile and supplies the values of its tags, so the wording of
   * `body` never leaves this process and the code has to travel separately.
   * For every caller here that is a single element — the six-digit code.
   *
   * Optional because a carrier that takes free text needs none of it, and
   * because a future non-code message would have nothing to put here.
   */
  templateParams?: readonly string[];
}

export interface SmsProvider {
  /**
   * Delivers a message. Resolves on hand-off to the carrier — which is an
   * acknowledgement of acceptance, not of delivery to the handset. Rejects if
   * the carrier refuses it.
   */
  send(message: SmsMessage): Promise<{ providerMessageId: string | null }>;

  /** Identifies the implementation in logs and health output. */
  readonly name: string;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
