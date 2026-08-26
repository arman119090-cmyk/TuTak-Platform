/**
 * The QR code a partner displays at the till identifies the partner — and,
 * when the partner has printed a per-branch code, which of their branches —
 * never an amount. The customer types the amount themselves on the next
 * screen and a `PurchaseIntent` carries it from there, so nothing about the
 * purchase is ever baked into the code a partner prints or into what a
 * cashier can redeem unilaterally (`docs/NEXT_CLAUDE_TASK.md`, requirement
 * 1-2). `apps/partner/src/lib/partnerPayQr.ts` builds the matching payload;
 * see there for why a branch id is a second colon-separated segment rather
 * than a replacement of the plain partner-only form.
 */
const PREFIX = 'TUTAK-PAY:';

export function parsePartnerPayQr(raw: string): { partnerId: string; branchId?: string } | null {
  if (!raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length).trim();
  if (!rest) return null;
  const [partnerId, branchId] = rest.split(':');
  if (!partnerId) return null;
  return branchId ? { partnerId, branchId } : { partnerId };
}
