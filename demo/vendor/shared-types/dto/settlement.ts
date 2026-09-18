import type {
  PartnerSettlementStatus,
  ReconciliationOutcome,
  ReconciliationSource,
} from '../enums/settlement';

/**
 * A settlement as every client reads it.
 *
 * ## Why this lives here rather than in each dashboard
 *
 * It did not, and that cost a real bug on 15.09.2026: the partner dashboard
 * typed these rows itself and invented `deductionsAmount`, `netAmount` and
 * `transferReference`, where the API returns `deductionAmount`,
 * `netPayableAmount` and `bankTransferReference`. The screen would have
 * rendered `NaN` in place of the amount owed. Eight tests passed, because the
 * fixture repeated the same invented names — a fixture that agrees with the
 * client instead of with the server proves nothing.
 *
 * Field names therefore match the Prisma model exactly, because these rows
 * come straight from `PartnerSettlementService` with no mapping layer. A
 * mismatch is now a `tsc` error in every consumer rather than a number a
 * partner has to notice.
 *
 * Decimals cross the wire as strings. Never parse one into a `number` to do
 * arithmetic on money — only to format it for display.
 */
export interface PartnerSettlementDto {
  id: string;
  partnerId: string;
  status: PartnerSettlementStatus;
  periodStart: string;
  periodEnd: string;
  accruedAmount: string;
  deductionAmount: string;
  netPayableAmount: string;
  currency: string;
  entryCount: number;
  documentNumber: string | null;
  bankTransferReference: string | null;
  bankAccountId: string | null;
  /** The maker. Compared against the viewer to refuse self-approval. */
  createdByUserId: string | null;
  createdAt: string;
  /** The checker. Never the same person as `createdByUserId`. */
  approvedByUserId: string | null;
  approvedAt: string | null;
  paidByUserId: string | null;
  paidAt: string | null;
  failedReason: string | null;
  cancelledByUserId: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  reconciliationSource: ReconciliationSource | null;
  reconciliationReportedByUserId: string | null;
  reconciliationReportedAt: string | null;
  reconciliationOutcome: ReconciliationOutcome | null;
  reconciliationEvidence: string | null;
  reconciliationProposedByUserId: string | null;
  reconciliationProposedAt: string | null;
  reconciliationConfirmedByUserId: string | null;
  reconciliationConfirmedAt: string | null;
  _count?: { entries: number };
}

/** One claimed ledger posting, traced back to what produced it. */
export interface PartnerSettlementEntryDto {
  id: string;
  settlementId: string;
  ledgerPostingId: string;
  partnerId: string;
  amount: string;
  direction: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
}

/**
 * What has accrued since the last settlement and nobody has drafted yet.
 *
 * `unrecognised` lists posting kinds nobody has classified. It is surfaced
 * rather than dropped: an unclassified posting on a partner's account is
 * money whose side nobody has decided, and hiding it would make the three
 * figures above it quietly incomplete.
 */
export interface UnsettledPositionDto {
  partnerId: string;
  accrued: string;
  deductions: string;
  net: string;
  entries: PartnerSettlementEntryDto[];
  unrecognised: string[];
}

/** A statement as a partner reads it: the settlement plus its itemisation. */
export interface PartnerStatementDto {
  settlement: PartnerSettlementDto;
  entries: PartnerSettlementEntryDto[];
}
