/**
 * The payload a partner displays for a customer to scan. It identifies the
 * partner — and, when given, which of the partner's branches — never an
 * amount, so nothing about a purchase is ever baked into a code a partner
 * prints. The customer types the amount themselves in the app and a
 * `PurchaseIntent` carries it from there, landing on
 * `PurchaseIntent.partnerBranchId` when a branch was encoded.
 * `apps/mobile/src/presentation/utils/partnerPayQr.ts` parses the matching
 * payload back out.
 *
 * A branch id is appended after a second colon (`TUTAK-PAY:<partnerId>:<branchId>`)
 * rather than replacing the plain `TUTAK-PAY:<partnerId>` form — the
 * two-argument shape is additive, so a partner with no branches at all still
 * gets the exact payload this always produced.
 */
const PREFIX = 'TUTAK-PAY:';

export function buildPartnerPayQrPayload(partnerId: string, branchId?: string): string {
  return branchId ? `${PREFIX}${partnerId}:${branchId}` : `${PREFIX}${partnerId}`;
}
