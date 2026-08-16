/**
 * The QR code a partner displays at the till identifies the partner only —
 * never an amount. The customer types the amount themselves on the next
 * screen and a `PurchaseIntent` carries it from there, so nothing about the
 * purchase is ever baked into the code a partner prints or into what a
 * cashier can redeem unilaterally (`docs/NEXT_CLAUDE_TASK.md`, requirement
 * 1-2). `apps/partner/src/lib/partnerPayQr.ts` builds the matching payload.
 */
const PREFIX = 'TUTAK-PAY:';

export function parsePartnerPayQr(raw: string): { partnerId: string } | null {
  if (!raw.startsWith(PREFIX)) return null;
  const partnerId = raw.slice(PREFIX.length).trim();
  if (!partnerId) return null;
  return { partnerId };
}
