/**
 * The legal package: the texts, and the evidence of choosing them.
 *
 * Shared because both halves of the contract have to agree on the same
 * revision id and the same content hash — the app quotes back exactly what it
 * showed, and the API checks it against what it published.
 */

export type LegalConsentPurpose =
  | 'TERMS_AND_BONUS_RULES'
  | 'PERSONAL_DATA_REQUIRED'
  | 'MARKETING_SMS'
  | 'MARKETING_PUSH'
  | 'MARKETING_EMAIL'
  | 'PERSONALIZED_RECOMMENDATIONS'
  | 'AVATAR_IN_REFERRAL_LIST'
  | 'AGE_CONFIRMATION_18';

export interface LegalDocumentSummaryDto {
  key: string;
  title: string;
  /** Revision of the whole package, e.g. `0.9-draft-2026-09-22`. */
  revision: string;
  language: string;
  /** SHA-256 of the text, lowercase hex. */
  contentHash: string;
  /** True while the owner has not approved this revision — shown as such. */
  isDraft: boolean;
}

export interface LegalDocumentDto extends LegalDocumentSummaryDto {
  /** Markdown, as published. The hash above is taken over exactly these bytes. */
  content: string;
}

export interface LegalDocumentIndexDto {
  revision: string;
  published: boolean;
  isDraft: boolean;
  language: string;
  /** The languages the texts really exist in. Not the interface languages. */
  availableLanguages: string[];
  requiredConsents: Array<{ purpose: string; documents: string[] }>;
  documents: LegalDocumentSummaryDto[];
}

/** One choice, made against named texts the client quotes back. */
export interface LegalConsentAcceptanceDto {
  purpose: LegalConsentPurpose;
  language: string;
  revision: string;
  documents: Array<{ key: string; contentHash: string }>;
}

export interface LegalConsentStateDto {
  currentRevision: string;
  published: boolean;
  consentEnforced: boolean;
  requiredPurposes: LegalConsentPurpose[];
  consents: Array<{
    purpose: LegalConsentPurpose;
    granted: boolean;
    revision: string;
    language: string;
    recordedAt: string;
  }>;
}
