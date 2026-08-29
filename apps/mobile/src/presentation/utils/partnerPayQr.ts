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

/**
 * A `fuel`-category branch's own scan-to-pay code — a cryptographically
 * random, server-issued `PartnerBranchQrCode.token`, opaque on purpose (see
 * that model's docblock). Distinct from `TUTAK-PAY:` above: this payload
 * carries no partner/branch id at all, so nothing here can be trusted
 * client-side — `partnerBranchQrApi.resolve(token)` is what turns it into a
 * `{partnerId, partnerBranchId}` pair, and an unresolvable token (revoked,
 * unknown, or belonging to a since-closed branch) is a scan failure, never
 * a fallback to the plain partner-only form above.
 */
const BRANCH_PREFIX = 'TUTAK-BRANCH:';

export function parseBranchQrToken(raw: string): string | null {
  if (!raw.startsWith(BRANCH_PREFIX)) return null;
  const token = raw.slice(BRANCH_PREFIX.length).trim();
  return token || null;
}
