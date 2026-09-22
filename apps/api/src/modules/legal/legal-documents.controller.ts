import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LegalDocumentsService, LegalDocumentText } from './legal-documents.service';

/**
 * The legal texts, readable without an account.
 *
 * Public on purpose and by requirement: the two consents on the registration
 * screen link straight here, and a person has to be able to read what they
 * are agreeing to *before* there is an account or an SMS. `/file` returns the
 * same text as a saveable attachment, because a link to a page that will be
 * rewritten is not a copy of what was accepted.
 *
 * While the publication gate is closed, every route here answers 404 unless
 * the deployment explicitly enables draft preview — and in preview each
 * response carries `isDraft: true`, which the app renders as "Проект для
 * согласования". There is no configuration that publishes a text with a
 * placeholder in it.
 */
@ApiTags('legal')
@Controller({ path: 'legal', version: VERSION_NEUTRAL })
export class LegalDocumentsController {
  constructor(private readonly documents: LegalDocumentsService) {}

  @Public()
  @Get('documents')
  list(@Query('lang') lang?: string) {
    this.assertVisible();
    const language = this.resolveLanguage(lang);
    const state = this.documents.publicationState();
    return {
      revision: state.revision,
      published: state.publishable,
      isDraft: !state.publishable,
      language,
      availableLanguages: this.documents.languages(),
      requiredConsents: this.documents.requiredConsents(),
      documents: this.documents.listDocuments(language).map((text) => this.summary(text)),
    };
  }

  @Public()
  @Get('documents/:key')
  async get(@Param('key') key: string, @Query('lang') lang?: string, @Query('revision') revision?: string) {
    this.assertVisible();
    const language = this.resolveLanguage(lang);
    const text = await this.resolve(key, language, revision);
    return { ...this.summary(text), content: text.content };
  }

  /**
   * The same edition as a file the person can keep.
   *
   * Markdown rather than PDF: it is the byte-for-byte text the hash was taken
   * over, so a saved copy can still be checked against the consent record.
   */
  @Public()
  @Get('documents/:key/file')
  async file(
    @Res() res: Response,
    @Param('key') key: string,
    @Query('lang') lang?: string,
    @Query('revision') revision?: string,
  ) {
    this.assertVisible();
    const language = this.resolveLanguage(lang);
    const text = await this.resolve(key, language, revision);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tutak-${text.key}-${text.revision}-${language}.md"`);
    res.setHeader('X-Legal-Content-Sha256', text.contentHash);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(text.content);
  }

  /**
   * Why the texts are not public yet, in full, for the owner.
   *
   * Behind `USER_MANAGE` and not public: the blockers name unfilled fields of
   * the operator's own registration details, and the list of what a company
   * has not decided yet is not a public document.
   */
  @ApiBearerAuth()
  @RequirePermissions(PermissionName.USER_MANAGE)
  @Get('publication-state')
  publicationState() {
    const state = this.documents.publicationState();
    return {
      ...state,
      consentEnforced: this.documents.consentEnforced(),
      languages: this.documents.languages(),
      documents: this.documents.documentKeys(),
    };
  }

  private assertVisible(): void {
    if (!this.documents.isVisible()) {
      throw new NotFoundException({
        message: 'The legal documents are not published yet',
        code: 'LEGAL_NOT_PUBLISHED',
      });
    }
  }

  /**
   * The document language, which is not the interface language.
   *
   * The package exists in Russian and Armenian. An English interface
   * therefore has no English text to show, and the honest answer is to say so
   * and let the person choose — not to hand them Russian labelled English.
   * `?lang=en` is a 400 that carries the real choice.
   */
  private resolveLanguage(lang?: string): string {
    const available = this.documents.languages();
    if (!lang) return available[0] ?? 'ru';
    if (!available.includes(lang)) {
      throw new BadRequestException({
        message: `The legal texts are published in ${available.join(', ')}; "${lang}" is not one of them`,
        code: 'LEGAL_LANGUAGE_UNSUPPORTED',
        available,
      });
    }
    return lang;
  }

  private async resolve(key: string, language: string, revision?: string): Promise<LegalDocumentText> {
    const text = revision
      ? await this.documents.getArchived(key, language, revision)
      : this.documents.getCurrent(key, language);
    if (!text) {
      throw new NotFoundException({ message: `No legal document "${key}" in ${language}`, code: 'LEGAL_DOCUMENT_UNKNOWN' });
    }
    return text;
  }

  private summary(text: LegalDocumentText) {
    return {
      key: text.key,
      title: text.title,
      revision: text.revision,
      language: text.language,
      contentHash: text.contentHash,
      isDraft: text.isDraft,
    };
  }
}
