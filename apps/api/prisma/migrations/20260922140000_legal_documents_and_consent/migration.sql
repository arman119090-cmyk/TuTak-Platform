-- CreateEnum
CREATE TYPE "LegalConsentPurpose" AS ENUM ('TERMS_AND_BONUS_RULES', 'PERSONAL_DATA_REQUIRED', 'MARKETING_SMS', 'MARKETING_PUSH', 'MARKETING_EMAIL', 'PERSONALIZED_RECOMMENDATIONS', 'AVATAR_IN_REFERRAL_LIST', 'AGE_CONFIRMATION_18');

-- CreateEnum
CREATE TYPE "LegalConsentAction" AS ENUM ('ACCEPT', 'REVOKE');

-- CreateTable
CREATE TABLE "legal_document_revisions" (
    "id" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "LegalConsentPurpose" NOT NULL,
    "action" "LegalConsentAction" NOT NULL,
    "documents" JSONB NOT NULL,
    "revision" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "appVersion" TEXT,
    "registrationChallengeId" TEXT,
    "ipAddress" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,

    CONSTRAINT "legal_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_document_revisions_revision_idx" ON "legal_document_revisions"("revision");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_revisions_documentKey_revision_language_key" ON "legal_document_revisions"("documentKey", "revision", "language");

-- CreateIndex
CREATE UNIQUE INDEX "legal_consent_records_idempotencyKey_key" ON "legal_consent_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "legal_consent_records_userId_purpose_recordedAt_idx" ON "legal_consent_records"("userId", "purpose", "recordedAt");

-- CreateIndex
CREATE INDEX "legal_consent_records_revision_idx" ON "legal_consent_records"("revision");

-- AddForeignKey
ALTER TABLE "legal_consent_records" ADD CONSTRAINT "legal_consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

