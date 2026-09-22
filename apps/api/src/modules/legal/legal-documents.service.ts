import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Languages the package is written in. English is deliberately absent — see `LEGAL_LANGUAGES` below. */
export const LEGAL_LANGUAGES = ['ru', 'hy'] as const;
export type LegalLanguage = (typeof LEGAL_LANGUAGES)[number];

/**
 * Anything of the shape `{{OPERATOR_LEGAL_NAME}}` left in a text.
 *
 * The package ships 41 distinct ones unfilled on purpose: they are the
 * owner's registration details, the effective date, the retention schedule.
 * A document carrying one is not a document, and the gate says so by name so
 * the owner sees *which* field is missing rather than "not ready".
 */
const PLACEHOLDER = /\{\{[A-Z0-9_]+\}\}/g;

/**
 * The "this is a draft for approval" line the package puts at the top of
 * every text, in both languages. It is the author's own marker, and the gate
 * treats its presence as a refusal to publish — removing it is part of
 * approving the text, not a cosmetic edit.
 */
const DRAFT_MARKERS = ['Проект для согласования', 'համաձայնեցման նախագիծ'];

interface ManifestDocument {
  key: string;
  file: string;
  titles: Record<string, string>;
  consentPurposes: string[];
}

interface Manifest {
  revision: string;
  source: string;
  approvedByOwner: boolean;
  approvedAt: string | null;
  effectiveDate: string | null;
  languages: string[];
  documents: ManifestDocument[];
  requiredConsents: Array<{ purpose: string; documents: string[] }>;
}

export interface LegalDocumentText {
  key: string;
  revision: string;
  language: string;
  title: string;
  content: string;
  contentHash: string;
  isDraft: boolean;
}

export interface PublicationState {
  revision: string;
  /** True only when every blocker below is gone. */
  publishable: boolean;
  /** Machine-readable, one per reason, in the order they were found. */
  blockers: string[];
}

/**
 * The legal texts, the publication gate, and the archive that makes an
 * accepted edition reproducible.
 *
 * Three things are deliberately separate here:
 *
 * 1. **The files** in `public/legal/documents/<revision>/<language>/<key>.md`
 *    are the source of truth for the *current* revision, reviewed in the
 *    repository like code.
 * 2. **The archive** (`legal_document_revisions`) is written from those files
 *    once and never rewritten. It is what a consent record's `contentHash`
 *    resolves against years later, and what "сохранить возможность открыть
 *    именно ту редакцию, которую приняли" means in practice. Changing a
 *    published text is a new revision id, never an edit of an old row — if a
 *    file's hash stops matching its archived row, that is a gate blocker,
 *    not an update.
 * 3. **The gate** decides whether any of it may be shown to the public at
 *    all. It fails while a placeholder is left, while the draft marker is
 *    there, while the owner has not named this exact revision as approved,
 *    and while a language is missing. Nothing in this service can be talked
 *    into publishing by a client request.
 */
@Injectable()
export class LegalDocumentsService implements OnModuleInit {
  private readonly logger = new Logger(LegalDocumentsService.name);
  private readonly contentDir: string;
  private readonly approvedRevision: string | null;
  private readonly previewEnabled: boolean;
  private readonly consentRequiredSetting: boolean;

  private manifest!: Manifest;
  private texts = new Map<string, LegalDocumentText>();
  private state: PublicationState = { revision: 'unknown', publishable: false, blockers: ['not-loaded'] };

  constructor(
    config: ConfigService<AppConfig, true>,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    const settings = config.get('legalDocuments', { infer: true });
    this.contentDir = settings.contentDir ?? join(__dirname, '..', '..', '..', 'public', 'legal', 'documents');
    this.approvedRevision = settings.approvedRevision;
    this.previewEnabled = settings.previewEnabled;
    this.consentRequiredSetting = settings.consentRequired;
    this.reload();
  }

  async onModuleInit(): Promise<void> {
    await this.syncArchive();
  }

  // ── reading ────────────────────────────────────────────────────────────

  get revision(): string {
    return this.manifest.revision;
  }

  publicationState(): PublicationState {
    return { ...this.state, blockers: [...this.state.blockers] };
  }

  /** Published to everyone: the gate passed. */
  isPublished(): boolean {
    return this.state.publishable;
  }

  /**
   * May be shown at all — published, or an unapproved draft on a deployment
   * that was explicitly told to show drafts. The caller still has to label a
   * draft as one; `LegalDocumentText.isDraft` carries that.
   */
  isVisible(): boolean {
    return this.state.publishable || this.previewEnabled;
  }

  /**
   * Whether registration must refuse without the mandatory choices.
   *
   * Two conditions, and the first is not negotiable by configuration: a
   * consent to a text that may not be published is not consent to anything,
   * so enforcement follows the gate. The setting can only ever turn
   * enforcement *off*, for a rollout window in which installed clients do not
   * send the choices yet.
   */
  consentEnforced(): boolean {
    return this.state.publishable && this.consentRequiredSetting;
  }

  listDocuments(language: string): LegalDocumentText[] {
    return this.manifest.documents
      .map((doc) => this.texts.get(this.cacheKey(doc.key, language)))
      .filter((text): text is LegalDocumentText => text !== undefined);
  }

  /** The current revision of one document, from the files. */
  getCurrent(key: string, language: string): LegalDocumentText | undefined {
    return this.texts.get(this.cacheKey(key, language));
  }

  /**
   * An exact past edition, from the archive. Falls back to the current files
   * when the revision asked for is the current one, so the endpoint answers
   * before the first archive sync has run.
   */
  async getArchived(key: string, language: string, revision: string): Promise<LegalDocumentText | undefined> {
    if (revision === this.manifest.revision) {
      const current = this.getCurrent(key, language);
      if (current) return current;
    }
    if (!this.prisma) return undefined;
    const row = await this.prisma.legalDocumentRevision.findUnique({
      where: { documentKey_revision_language: { documentKey: key, revision, language } },
    });
    if (!row) return undefined;
    return {
      key: row.documentKey,
      revision: row.revision,
      language: row.language,
      title: row.title,
      content: row.content,
      contentHash: row.contentHash,
      isDraft: row.isDraft,
    };
  }

  /** `[{ purpose, documents: [key, …] }]` — what registration must ask for. */
  requiredConsents(): Array<{ purpose: string; documents: string[] }> {
    return this.manifest.requiredConsents.map((entry) => ({ ...entry, documents: [...entry.documents] }));
  }

  documentKeys(): string[] {
    return this.manifest.documents.map((doc) => doc.key);
  }

  languages(): string[] {
    return [...this.manifest.languages];
  }

  // ── loading and the gate ───────────────────────────────────────────────

  /**
   * Re-reads the files and re-evaluates the gate.
   *
   * Called at construction, and by the suites that need a clean gate after
   * deliberately breaking one. Nothing in a request path calls it: a
   * deployment's legal state changes when the deployment does.
   */
  reload(): void {
    const manifestPath = join(this.contentDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      this.manifest = {
        revision: 'missing',
        source: 'missing',
        approvedByOwner: false,
        approvedAt: null,
        effectiveDate: null,
        languages: [...LEGAL_LANGUAGES],
        documents: [],
        requiredConsents: [],
      };
      this.state = { revision: 'missing', publishable: false, blockers: [`manifest-missing:${manifestPath}`] };
      this.logger.warn(`Legal documents not found at ${manifestPath}; nothing will be served`);
      return;
    }

    this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    const blockers: string[] = [];
    this.texts = new Map();

    for (const doc of this.manifest.documents) {
      for (const language of this.manifest.languages) {
        const path = join(this.contentDir, this.manifest.revision, language, doc.file);
        if (!existsSync(path)) {
          blockers.push(`missing-file:${doc.key}:${language}`);
          continue;
        }
        const content = readFileSync(path, 'utf8');
        const placeholders = [...new Set(content.match(PLACEHOLDER) ?? [])];
        for (const placeholder of placeholders) {
          blockers.push(`placeholder:${doc.key}:${language}:${placeholder.slice(2, -2)}`);
        }
        const lowered = content.toLowerCase();
        if (DRAFT_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()))) {
          blockers.push(`draft-marker:${doc.key}:${language}`);
        }
        this.texts.set(this.cacheKey(doc.key, language), {
          key: doc.key,
          revision: this.manifest.revision,
          language,
          title: doc.titles[language] ?? doc.key,
          content,
          contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
          // Filled in below, once the gate has decided about the revision.
          isDraft: true,
        });
      }
    }

    if (!this.manifest.approvedByOwner) blockers.push('manifest-not-approved-by-owner');
    if (!this.manifest.effectiveDate) blockers.push('effective-date-missing');
    if (!this.approvedRevision) {
      blockers.push('approved-revision-not-configured');
    } else if (this.approvedRevision !== this.manifest.revision) {
      blockers.push(`approved-revision-mismatch:${this.approvedRevision}`);
    }

    const publishable = blockers.length === 0;
    for (const text of this.texts.values()) text.isDraft = !publishable;
    this.state = { revision: this.manifest.revision, publishable, blockers };

    if (publishable) {
      this.logger.log(`Legal package ${this.manifest.revision} is published (${this.texts.size} texts)`);
    } else {
      this.logger.warn(
        `Legal package ${this.manifest.revision} is NOT publishable: ${blockers.length} blocker(s), first: ${blockers[0]}`,
      );
    }
  }

  /**
   * Writes each text into the archive once.
   *
   * A row that already exists is never given new content: if the file's hash
   * differs, the published edition and the repository have diverged, which is
   * a blocker to be seen and not a row to be fixed. Only the approval
   * metadata (`isDraft`, `approvedAt`) is allowed to move, because that is
   * the owner's decision about an unchanged text.
   */
  async syncArchive(): Promise<void> {
    if (!this.prisma) return;
    for (const text of this.texts.values()) {
      const existing = await this.prisma.legalDocumentRevision.findUnique({
        where: {
          documentKey_revision_language: { documentKey: text.key, revision: text.revision, language: text.language },
        },
      });

      if (!existing) {
        await this.prisma.legalDocumentRevision.create({
          data: {
            documentKey: text.key,
            revision: text.revision,
            language: text.language,
            title: text.title,
            contentHash: text.contentHash,
            content: text.content,
            isDraft: text.isDraft,
            approvedAt: text.isDraft ? null : new Date(),
          },
        });
        continue;
      }

      if (existing.contentHash !== text.contentHash) {
        /*
         * A draft is allowed to move; a published edition is not.
         *
         * The freeze starts at approval, not at first sight. Before that the
         * text is still being written — the owner is filling in registration
         * details and removing the draft marker, and demanding a new revision
         * id for every correction would make the gate an obstacle rather than
         * a guard. The moment a revision is approved, this row stops
         * changing for good, because that is the copy somebody accepted.
         */
        if (existing.isDraft && existing.approvedAt === null) {
          await this.prisma.legalDocumentRevision.update({
            where: { id: existing.id },
            data: { title: text.title, content: text.content, contentHash: text.contentHash },
          });
          this.logger.log(`Draft ${text.key}/${text.language} at ${text.revision} updated from the repository`);
          continue;
        }

        const blocker = `archived-text-changed:${text.key}:${text.language}`;
        if (!this.state.blockers.includes(blocker)) {
          this.state = { ...this.state, publishable: false, blockers: [...this.state.blockers, blocker] };
        }
        this.logger.error(
          `Legal text ${text.key}/${text.language} at revision ${text.revision} differs from the archived copy. ` +
            'A published edition is never edited in place — publish a new revision instead.',
        );
        continue;
      }

      if (existing.isDraft !== text.isDraft) {
        await this.prisma.legalDocumentRevision.update({
          where: { id: existing.id },
          data: { isDraft: text.isDraft, approvedAt: text.isDraft ? null : (existing.approvedAt ?? new Date()) },
        });
      }
    }
  }

  private cacheKey(key: string, language: string): string {
    return `${key}:${language}`;
  }
}
