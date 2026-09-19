-- CreateEnum
CREATE TYPE "SettlementPeriodicity" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PartnerSettlementStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "settlementAnchorDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "settlementPeriodicity" "SettlementPeriodicity" NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE "partner_bank_accounts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "swiftBic" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    "replacedByUserId" TEXT,

    CONSTRAINT "partner_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlements" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PartnerSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "accruedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deductionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPayableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "documentNumber" TEXT,
    "documentDate" TIMESTAMP(3),
    "documentReference" TEXT,
    "bankTransferReference" TEXT,
    "bankAccountId" TEXT,
    "beneficiarySnapshot" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "ledgerTransactionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_entries" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "ledgerPostingId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "direction" "PostingDirection" NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settlement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_bank_accounts_partnerId_isActive_idx" ON "partner_bank_accounts"("partnerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_ledgerTransactionId_key" ON "partner_settlements"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "partner_settlements_partnerId_periodStart_idx" ON "partner_settlements"("partnerId", "periodStart");

-- CreateIndex
CREATE INDEX "partner_settlements_status_idx" ON "partner_settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_currency_bankTransferReference_key" ON "partner_settlements"("currency", "bankTransferReference");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_entries_ledgerPostingId_key" ON "partner_settlement_entries"("ledgerPostingId");

-- CreateIndex
CREATE INDEX "partner_settlement_entries_settlementId_idx" ON "partner_settlement_entries"("settlementId");

-- CreateIndex
CREATE INDEX "partner_settlement_entries_partnerId_occurredAt_idx" ON "partner_settlement_entries"("partnerId", "occurredAt");

-- AddForeignKey
ALTER TABLE "partner_bank_accounts" ADD CONSTRAINT "partner_bank_accounts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "partner_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_entries" ADD CONSTRAINT "partner_settlement_entries_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "partner_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_entries" ADD CONSTRAINT "partner_settlement_entries_ledgerPostingId_fkey" FOREIGN KEY ("ledgerPostingId") REFERENCES "ledger_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- Guarantees Prisma cannot express.
--
-- The brief is explicit that these belong in the database and not in a
-- disabled button: a retried worker, a second admin and a concurrent request
-- all reach the same table, and only the table can arbitrate between them.
-- ────────────────────────────────────────────────────────────────────────

-- One live payment destination per partner. Partial, so the history rows
-- (isActive = false) are unconstrained and nothing has to be deleted to
-- change where the money goes.
CREATE UNIQUE INDEX "partner_bank_accounts_one_active_per_partner"
  ON "partner_bank_accounts" ("partnerId")
  WHERE "isActive";

-- The arithmetic of the row must hold. A settlement whose net does not equal
-- accrued minus deductions is not a rounding question, it is a bug, and it
-- should be impossible to persist rather than caught later by a report.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_net_is_accrued_minus_deduction"
  CHECK ("netPayableAmount" = "accruedAmount" - "deductionAmount");

-- Only a positive balance is ever paid out. A non-positive balance is not
-- settled at all — its postings stay unclaimed and carry into the next
-- period, which is how a partner's debt is offset against future earnings.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_paid_is_positive"
  CHECK ("status" <> 'PAID' OR "netPayableAmount" > 0);

-- A settlement that claims to be paid must say how. Without this, "PAID"
-- could be set with no bank reference and no ledger posting, which is a
-- record that the money moved with nothing backing it.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_paid_has_evidence"
  CHECK (
    "status" <> 'PAID'
    OR ("bankTransferReference" IS NOT NULL AND "ledgerTransactionId" IS NOT NULL AND "paidAt" IS NOT NULL)
  );

-- Approval is a different person's act. Recording it requires both who and
-- when, so an approved settlement can always name its checker.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_approved_has_actor"
  CHECK (
    "status" NOT IN ('APPROVED', 'PAYMENT_PENDING', 'PAID')
    OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );

-- A period must be a period.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_period_is_ordered"
  CHECK ("periodEnd" > "periodStart");

-- A claimed posting's amount is always positive; its direction carries the
-- sign, exactly as in `ledger_postings` itself.
ALTER TABLE "partner_settlement_entries"
  ADD CONSTRAINT "partner_settlement_entries_amount_positive"
  CHECK ("amount" > 0);

-- ── A PAID settlement is history ────────────────────────────────────────
--
-- Invariant 6 of the brief. Not "the UI does not offer it": the row itself
-- refuses. This is what makes "never rewrite a paid payout" true even for a
-- migration script or a console session.
CREATE OR REPLACE FUNCTION "partner_settlement_paid_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PAID' THEN
    RAISE EXCEPTION
      'partner_settlements: settlement % is PAID and cannot be changed or deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_settlements_paid_immutable"
  BEFORE UPDATE OR DELETE ON "partner_settlements"
  FOR EACH ROW EXECUTE FUNCTION "partner_settlement_paid_is_immutable"();

-- ── An approved settlement's contents are frozen ────────────────────────
--
-- §4: "после формирования settlement нельзя, чтобы будущая новая операция
-- тихо изменила сумму уже утверждённого банковского платежа". Claiming is
-- what freezes the amount; this stops the set of claims changing after a
-- human has approved the figure they were shown.
CREATE OR REPLACE FUNCTION "partner_settlement_entries_frozen_after_approval"()
RETURNS trigger AS $$
DECLARE
  target_id text;
  target_status "PartnerSettlementStatus";
BEGIN
  target_id := COALESCE(NEW."settlementId", OLD."settlementId");
  SELECT "status" INTO target_status FROM "partner_settlements" WHERE "id" = target_id;
  IF target_status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID') THEN
    RAISE EXCEPTION
      'partner_settlement_entries: settlement % is %, its entries are frozen', target_id, target_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_settlement_entries_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "partner_settlement_entries"
  FOR EACH ROW EXECUTE FUNCTION "partner_settlement_entries_frozen_after_approval"();

-- ── A claimed posting belongs to the partner being settled ──────────────
--
-- Cheap to check, and it closes the one way a settlement could pay partner A
-- out of partner B's earnings: a bug in the candidate query.
CREATE OR REPLACE FUNCTION "partner_settlement_entry_matches_partner"()
RETURNS trigger AS $$
DECLARE
  settlement_partner text;
BEGIN
  SELECT "partnerId" INTO settlement_partner
    FROM "partner_settlements" WHERE "id" = NEW."settlementId";
  IF settlement_partner IS DISTINCT FROM NEW."partnerId" THEN
    RAISE EXCEPTION
      'partner_settlement_entries: entry for partner % cannot join settlement % (partner %)',
      NEW."partnerId", NEW."settlementId", settlement_partner
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_settlement_entry_partner_matches"
  BEFORE INSERT OR UPDATE ON "partner_settlement_entries"
  FOR EACH ROW EXECUTE FUNCTION "partner_settlement_entry_matches_partner"();
