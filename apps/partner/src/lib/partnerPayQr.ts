/**
 * The payload a partner displays for a customer to scan. It identifies the
 * partner only — never an amount — so nothing about a purchase is ever
 * baked into a code a partner prints. The customer types the amount
 * themselves in the app and a `PurchaseIntent` carries it from there.
 * `apps/mobile/src/presentation/utils/partnerPayQr.ts` parses the matching
 * payload back out.
 */
const PREFIX = 'TUTAK-PAY:';

export function buildPartnerPayQrPayload(partnerId: string): string {
  return `${PREFIX}${partnerId}`;
}
