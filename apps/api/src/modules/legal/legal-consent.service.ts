import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LegalConsentAction, LegalConsentPurpose, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LegalDocumentsService } from './legal-documents.service';

export interface ConsentDocumentInput {
  key: string;
  contentHash: string;
}

export interface ConsentInput {
  purpose: LegalConsentPurpose | string;
  language: string;
  revision: string;
  documents: ConsentDocumentInput[];
}

/** An input that has been checked against the published texts. */
export interface ValidatedConsent {
  purpose: LegalConsentPurpose;
  language: string;
  revision: string;
  documents: Array<{ documentKey: string; revision: string; language: string; contentHash: string }>;
}

type Tx = Prisma.TransactionClient;

/**
 * The evidence half of the legal package: what was asked, what was chosen,
 * and against which exact text.
 *
 * Every rule here exists because a checkbox on a phone proves nothing by
 * itself (package §3):
 *
 * - the client's claim about *which text* it showed is verified against the
 *   published revision, never taken at its word;
 * - a revision that moved between opening the form and finishing it is a
 *   rejection, not a silent acceptance of the newer text;
 * - the record is written in the same transaction as the account, so an
 *   account cannot exist without the choices that justify it;
 * - a repeat of the same submit collapses onto one row through
 *   `idempotencyKey` instead of leaving two records that disagree;
 * - a revocation is a new row. The row that recorded the grant is never
 *   touched, because it is the answer to "what did they agree to in March".
 *
 * Nothing written here may carry an OTP, a password, a PIN or a token. The
 * link to the phone confirmation is the opaque id of the OTP token row.
 */
@Injectable()
export class LegalConsentService {
  private readonly logger = new Logger(LegalConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: LegalDocumentsService,
  ) {}

  /** Purposes registration must collect, in the order they are shown. */
  requiredPurposes(): LegalConsentPurpose[] {
    return this.documents.requiredConsents().map((entry) => entry.purpose as LegalConsentPurpose);
  }

  /**
   * Checks the mandatory choices a registration carries.
   *
   * Returns the validated set — empty when the deployment does not enforce
   * consent yet *and* the client sent nothing, which is the rollout window
   * for clients built before this existed. A client that sends something is
   * always checked: half-verified evidence is worse than none.
   */
  assertRegistrationAcceptance(inputs: ConsentInput[] | undefined): ValidatedConsent[] {
    const enforced = this.documents.consentEnforced();
    const provided = inputs ?? [];

    if (!enforced && provided.length === 0) return [];

    if (enforced && provided.length === 0) {
      throw new BadRequestException({
        message: 'Registration requires accepting the terms and the personal-data consent',
        code: 'LEGAL_CONSENT_REQUIRED',
        required: this.requiredPurposes(),
        revision: this.documents.revision,
      });
    }

    const validated: ValidatedConsent[] = [];
    for (const entry of this.documents.requiredConsents()) {
      const purpose = entry.purpose as LegalConsentPurpose;
      const input = provided.find((candidate) => candidate.purpose === purpose);
      if (!input) {
        if (!enforced) continue;
        throw new BadRequestException({
          message: `Missing the mandatory consent ${purpose}`,
          code: 'LEGAL_CONSENT_MISSING',
          purpose,
          revision: this.documents.revision,
        });
      }
      validated.push(this.validate(input, entry.documents));
    }

    return validated;
  }

  /** One consent input against the published texts. Throws with a code the app can act on. */
  validate(input: ConsentInput, expectedDocumentKeys?: string[]): ValidatedConsent {
    const purpose = input.purpose as LegalConsentPurpose;
    const current = this.documents.revision;

    if (input.revision !== current) {
      // Package §3: a text that changed between the form opening and being
      // submitted needs an explicit new choice, not an assumption.
      throw new BadRequestException({
        message: 'The legal texts changed while the form was open; please read and accept the current edition',
        code: 'LEGAL_REVISION_STALE',
        sentRevision: input.revision,
        currentRevision: current,
      });
    }

    if (!this.documents.languages().includes(input.language)) {
      throw new BadRequestException({
        message: `The legal texts are not published in "${input.language}"`,
        code: 'LEGAL_LANGUAGE_UNSUPPORTED',
        available: this.documents.languages(),
      });
    }

    const expected = expectedDocumentKeys ?? this.documentsForPurpose(purpose);
    const sentKeys = input.documents.map((doc) => doc.key).sort();
    if (expected.length > 0 && (sentKeys.length !== expected.length || !expected.every((key) => sentKeys.includes(key)))) {
      throw new BadRequestException({
        message: `Consent ${purpose} must be given against exactly: ${expected.join(', ')}`,
        code: 'LEGAL_CONSENT_DOCUMENTS_MISMATCH',
        expected,
      });
    }

    const documents = input.documents.map((doc) => {
      const text = this.documents.getCurrent(doc.key, input.language);
      if (!text) {
        throw new BadRequestException({
          message: `Unknown legal document "${doc.key}" in ${input.language}`,
          code: 'LEGAL_DOCUMENT_UNKNOWN',
        });
      }
      if (text.contentHash !== doc.contentHash) {
        // The client is quoting a text this server never published. Either it
        // is stale or it invented the digest; neither may become evidence.
        throw new BadRequestException({
          message: `The copy of "${doc.key}" the app showed does not match the published text`,
          code: 'LEGAL_CONTENT_HASH_MISMATCH',
          documentKey: doc.key,
        });
      }
      return {
        documentKey: text.key,
        revision: text.revision,
        language: text.language,
        contentHash: text.contentHash,
      };
    });

    return { purpose, language: input.language, revision: current, documents };
  }

  /**
   * Writes the accepted choices. Meant to run inside the transaction that
   * creates the account, which is what makes "an account always has its
   * consent records" true rather than usually true.
   */
  async recordAccepted(
    tx: Tx,
    params: {
      userId: string;
      consents: ValidatedConsent[];
      context: string;
      registrationChallengeId?: string | null;
      appVersion?: string | null;
      scope?: string;
    },
  ): Promise<void> {
    for (const consent of params.consents) {
      await this.write(tx, {
        userId: params.userId,
        purpose: consent.purpose,
        action: LegalConsentAction.ACCEPT,
        documents: consent.documents,
        revision: consent.revision,
        language: consent.language,
        context: params.context,
        appVersion: params.appVersion ?? null,
        registrationChallengeId: params.registrationChallengeId ?? null,
        idempotencyKey: this.idempotencyKey({
          userId: params.userId,
          purpose: consent.purpose,
          action: LegalConsentAction.ACCEPT,
          revision: consent.revision,
          scope: params.scope ?? params.registrationChallengeId ?? params.context,
        }),
      });
    }
  }

  /** A voluntary consent changed from settings. Always its own row. */
  async record(params: {
    userId: string;
    purpose: LegalConsentPurpose;
    action: LegalConsentAction;
    language: string;
    context: string;
    documents?: ValidatedConsent['documents'];
    appVersion?: string | null;
    scope?: string;
  }): Promise<void> {
    await this.write(this.prisma, {
      userId: params.userId,
      purpose: params.purpose,
      action: params.action,
      documents: params.documents ?? [],
      revision: this.documents.revision,
      language: params.language,
      context: params.context,
      appVersion: params.appVersion ?? null,
      registrationChallengeId: null,
      idempotencyKey: params.scope
        ? this.idempotencyKey({
            userId: params.userId,
            purpose: params.purpose,
            action: params.action,
            revision: this.documents.revision,
            scope: params.scope,
          })
        : null,
    });
  }

  /**
   * The current answer per purpose: the latest row wins, and a purpose with
   * no row is "never asked", which is not the same as "refused" and is never
   * reported as a grant.
   */
  async currentState(userId: string): Promise<
    Array<{ purpose: LegalConsentPurpose; granted: boolean; revision: string; language: string; recordedAt: Date }>
  > {
    const rows = await this.prisma.legalConsentRecord.findMany({
      where: { userId },
      orderBy: { recordedAt: 'asc' },
    });
    const latest = new Map<LegalConsentPurpose, (typeof rows)[number]>();
    for (const row of rows) latest.set(row.purpose, row);
    return [...latest.values()].map((row) => ({
      purpose: row.purpose,
      granted: row.action === LegalConsentAction.ACCEPT,
      revision: row.revision,
      language: row.language,
      recordedAt: row.recordedAt,
    }));
  }

  /** Whether a voluntary consent is currently granted. No row means no. */
  async isGranted(userId: string, purpose: LegalConsentPurpose): Promise<boolean> {
    const latest = await this.prisma.legalConsentRecord.findFirst({
      where: { userId, purpose },
      orderBy: { recordedAt: 'desc' },
    });
    return latest?.action === LegalConsentAction.ACCEPT;
  }

  private documentsForPurpose(purpose: LegalConsentPurpose): string[] {
    return this.documents.requiredConsents().find((entry) => entry.purpose === purpose)?.documents ?? [];
  }

  private idempotencyKey(params: {
    userId: string;
    purpose: LegalConsentPurpose;
    action: LegalConsentAction;
    revision: string;
    scope: string;
  }): string {
    return `${params.userId}:${params.purpose}:${params.action}:${params.revision}:${params.scope}`;
  }

  private async write(
    client: Tx | PrismaService,
    data: {
      userId: string;
      purpose: LegalConsentPurpose;
      action: LegalConsentAction;
      documents: ValidatedConsent['documents'];
      revision: string;
      language: string;
      context: string;
      appVersion: string | null;
      registrationChallengeId: string | null;
      idempotencyKey: string | null;
    },
  ): Promise<void> {
    try {
      await client.legalConsentRecord.create({
        data: {
          userId: data.userId,
          purpose: data.purpose,
          action: data.action,
          documents: data.documents as unknown as Prisma.InputJsonValue,
          revision: data.revision,
          language: data.language,
          context: data.context,
          appVersion: data.appVersion,
          registrationChallengeId: data.registrationChallengeId,
          idempotencyKey: data.idempotencyKey,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The same choice arriving twice — a retried request, a double tap.
        // One row is the correct outcome, and the first one already is it.
        this.logger.debug(`Duplicate consent submit collapsed: ${data.purpose} for ${data.userId}`);
        return;
      }
      throw err;
    }
  }
}
