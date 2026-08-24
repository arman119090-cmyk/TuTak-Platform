import { BadRequestException } from '@nestjs/common';

/**
 * Normalizes a bank-statement external transaction id before it is stored or
 * compared.
 *
 * The uniqueness control in `PartnerCollectionService` only works if the same
 * real transfer normalizes to the same string no matter which admin typed it
 * in. A bank statement transaction id (SWIFT UETR, a core-banking reference,
 * a local transfer id) is, in practice:
 *
 *  - Copy-pasted from a PDF or a banking portal, which routinely inserts
 *    incidental whitespace at the edges or — because statements are often
 *    formatted in fixed-width blocks — in the middle ("FT 23150 000123").
 *  - Rendered in whatever case the issuing bank's system happens to use, and
 *    two different banks (or the same bank's web vs. mobile export) are not
 *    guaranteed to agree; the *value* of the id carries no case-sensitive
 *    meaning the way a password or a hash would.
 *
 * So: trim the edges, collapse/remove internal whitespace, and uppercase.
 * This is deliberately more aggressive than `bankReference` (a free-text
 * label, trimmed only) because this field's entire job is exact-match
 * uniqueness — two admins who both typed the same id with different spacing
 * or casing must collide, not silently create two rows.
 */
export function normalizeBankTransactionId(raw: string): string {
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  if (!normalized) {
    throw new BadRequestException('A bank transaction id is required');
  }
  return normalized;
}
