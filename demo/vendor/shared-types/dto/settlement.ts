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
  /**
   * Which of the partner's own branches produced this line, where the source
   * records one.
   *
   * Set for the two source types that are sales — a purchase and an operation
   * row. Null for everything that is not: payouts, collections, commission,
   * the settlement's own carry-in. A partner checking a statement against
   * their tills needs the shop as well as the day, and null here means "this
   * line is not a sale", not "we lost the shop".
   *
   * Live name, not a snapshot — see `TransactionDto.branch`.
   */
  branch: SettlementBranchDto | null;
}

/** The branch behind a statement line. Address included for the same reason
    `TransactionBranchDto` carries one: chains reuse names. */
export interface SettlementBranchDto {
  id: string;
  name: string;
  address: string;
}

/**
 * What has accrued since the last settlement and nobody has drafted yet.
 *
 * `unrecognised` lists posting kinds nobody has classified. It is surfaced
 * rather than dropped: an unclassified posting on a partner's account is
 * money whose side nobody has decided, and hiding it would make the three
 * figures above it quietly incomplete.
 */
/**
 * A partner's money position, in five figures that do not overlap.
 *
 * `net` is what is *not yet in any settlement*: the balance of settleable
 * postings nobody has claimed. It is NOT what TuTak owes in total — the moment
 * a DRAFT settlement claims those postings `net` drops to zero while not one
 * dram has moved. The total is `ledgerBalance`, read from the payable account
 * itself, and it equals `net + inOpenSettlements + underReview` by
 * construction: a settlement takes postings out of `net` and holds them until
 * it is PAID, and PAID is the only status that posts a payout back to the
 * ledger. `paidTotal` is history — already deducted from `ledgerBalance` — and
 * is never added to anything.
 */
export interface UnsettledBreakdownDto {
  partnerId: string;
  /** Settleable credits not yet claimed by a settlement. */
  accrued: string;
  /** Settleable debits not yet claimed by a settlement. */
  deductions: string;
  /** `accrued - deductions`: what is not yet in any settlement. */
  net: string;
  entries: PartnerSettlementEntryDto[];
  unrecognised: string[];
}

export interface UnsettledPositionDto extends UnsettledBreakdownDto {
  /**
   * What TuTak owes this partner in total, from the ledger. Positive: TuTak
   * owes the partner. Negative: the partner owes TuTak (refunds after a
   * payout, contributions). Includes everything below except `paidTotal`.
   */
  ledgerBalance: string;
  /** Claimed by settlements that have not been paid yet (DRAFT, READY, APPROVED, PAYMENT_PENDING, FAILED). */
  inOpenSettlements: string;
  /** Claimed by settlements whose transfer nobody can yet confirm (REQUIRES_RECONCILIATION). */
  underReview: string;
  /** Paid out and posted; already subtracted from `ledgerBalance`. */
  paidTotal: string;
  /** When these figures were read. */
  asOf: string;
  /** Where the money in this partner's sales came from — brief §29. */
  funding: PartnerFundingBreakdownDto;
}

/**
 * All-time, confirmed sales, net of refunds. `receivedDirectly` is the
 * partner's own money taken at their till and never TuTak's;
 * `receivedViaProvider` is what the provider collected for TuTak on
 * `TUTAK_PSP` sales — TuTak's to settle, never in the till (audit D12);
 * `fundedByPrepaid` and `fundedByBonus` are what TuTak owes for;
 * `contribution` reduces it.
 */
export interface PartnerFundingBreakdownDto {
  salesGross: string;
  receivedDirectly: string;
  receivedViaProvider: string;
  fundedByPrepaid: string;
  fundedByBonus: string;
  contribution: string;
  refundedGross: string;
  owedToTuTak: string;
  collectionsConfirmed: string;
}

/** A statement as a partner reads it: the settlement plus its itemisation. */
export interface PartnerStatementDto {
  settlement: PartnerSettlementDto;
  entries: PartnerSettlementEntryDto[];
}

/**
 * Where one movement's money stands.
 *
 * The same four names the position tiles use, so a row and a tile cannot
 * describe the same amount differently. A cancelled settlement is absent on
 * purpose: cancelling deletes its claims, so its rows are `UNSETTLED` again,
 * which is what they are.
 */
export type PartnerActivityState = 'UNSETTLED' | 'IN_SETTLEMENT' | 'UNDER_REVIEW' | 'PAID';

/** One line of a partner's own account. */
export interface PartnerActivityRowDto {
  postingId: string;
  occurredAt: string;
  /** The ledger kind, as stored — what a partner quotes back to TuTak. */
  kind: string;
  /** What this line did to the debt, signed: positive raises what TuTak owes. */
  debtChange: string;
  state: PartnerActivityState;
  settlementId: string | null;
  sourceType: string;
  sourceId: string;
  /** The short, quotable form of `sourceId`. */
  reference: string;
  /** The branch by name only — never the organisation chain on every row. */
  branch: string | null;
  /** The person's permanent code, frozen at confirmation. Null when no person confirmed it. */
  employeeCode: string | null;
  confirmationSource: string | null;
  /** Whether this line can be itemised further by the purchase breakdown. */
  itemisable: boolean;
}

export interface PartnerActivityPageDto {
  rows: PartnerActivityRowDto[];
  /** Opaque; pass it back to continue. Null means this was the last page. */
  nextCursor: string | null;
  /**
   * The totals of what the *filter* selected. Never the organisation's
   * position: a branch's March is not what TuTak owes the business, and the
   * two must not be printed as the same kind of number.
   */
  selection: { credits: string; debits: string; net: string; rowCount: number };
  /** True when the selection above describes less than the whole account. */
  filtered: boolean;
}

/** Where one line of a purchase's ledger effect currently stands. */
export interface PurchaseBreakdownLineDto {
  kind: string;
  amount: string;
  occurredAt: string;
  state: 'UNSETTLED' | 'IN_SETTLEMENT' | 'PAID';
  settlementId: string | null;
}

/**
 * One purchase, and what it did to the debt.
 *
 * Deliberately silent about the pool split. What TuTak keeps of its own
 * share, and what it pays referrers, is not this partner's business and
 * telling them would leak other people's economics.
 */
export interface PurchaseBreakdownDto {
  purchaseIntentId: string;
  confirmationCode: string | null;
  confirmedAt: string | null;
  status: string;
  branchId: string | null;
  confirmationSource: string | null;
  employeeCode: string | null;
  grossAmount: string;
  bonusApplied: string;
  prepaidApplied: string;
  externalAmount: string;
  paymentRoute: string;
  /** Who ended up holding the money paid outside the customer's TuTak balances. */
  externalCollectedBy: 'PARTNER_TILL' | 'TUTAK_VIA_PROVIDER';
  refundedAmount: string;
  refunds: { id: string; amount: string; occurredAt: string }[];
  lines: PurchaseBreakdownLineDto[];
  /** What the purchase did to the debt in total, and where that money stands. */
  effectOnDebt: string;
  stillOwed: string;
  inOpenSettlement: string;
  paid: string;
}
