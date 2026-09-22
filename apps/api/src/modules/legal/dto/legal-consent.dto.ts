import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { LegalConsentPurpose } from '@prisma/client';

/** One document as the client claims it showed it. Both halves are checked server-side. */
export class LegalConsentDocumentDto {
  @IsString()
  @Length(1, 64)
  key: string;

  /**
   * SHA-256 of the text the person read, lowercase hex.
   *
   * Sent by the client and never believed: `LegalConsentService` looks the
   * published text up by (key, revision, language) and compares. A client
   * cannot turn an arbitrary string into evidence that a text existed.
   */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'contentHash must be a lowercase sha256 hex digest' })
  contentHash: string;
}

export class LegalConsentAcceptanceDto {
  @IsIn(Object.values(LegalConsentPurpose))
  purpose: LegalConsentPurpose;

  /** The language the person actually read, which need not be the interface language. */
  @IsString()
  @Length(2, 8)
  language: string;

  @IsString()
  @Length(1, 64)
  revision: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => LegalConsentDocumentDto)
  documents: LegalConsentDocumentDto[];
}

/** The optional consents, changed from settings — one channel per call, never bundled. */
export class UpdateOptionalConsentDto {
  @IsIn([
    LegalConsentPurpose.MARKETING_SMS,
    LegalConsentPurpose.MARKETING_PUSH,
    LegalConsentPurpose.MARKETING_EMAIL,
    LegalConsentPurpose.PERSONALIZED_RECOMMENDATIONS,
    LegalConsentPurpose.AVATAR_IN_REFERRAL_LIST,
  ])
  purpose: LegalConsentPurpose;

  @IsIn(['ACCEPT', 'REVOKE'])
  action: 'ACCEPT' | 'REVOKE';

  @IsOptional()
  @IsString()
  @Length(2, 8)
  language?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;
}
