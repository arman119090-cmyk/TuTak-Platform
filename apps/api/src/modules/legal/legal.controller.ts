import { Controller, Get, NotFoundException, Query, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { legalPage, markdownToHtml } from './legal-html';
import { LegalDocumentsService } from './legal-documents.service';

/** The chrome around the text, in the language the text itself is written in. */
const STRINGS: Record<string, { draft: string; revision: string; checksum: string; download: string; index: string; title: string }> = {
  ru: {
    draft: 'Проект для согласования. Документ ещё не утверждён и не имеет силы.',
    revision: 'Редакция {{revision}}',
    checksum: 'SHA-256 текста: ',
    download: 'Скачать эту редакцию файлом',
    index: 'Все документы',
    title: 'Правовая информация',
  },
  hy: {
    draft: 'Համաձայնեցման նախագիծ։ Փաստաթուղթը դեռ հաստատված չէ և ուժ չունի։',
    revision: 'Խմբագրություն՝ {{revision}}',
    checksum: 'Տեքստի SHA-256՝ ',
    download: 'Ներբեռնել այս խմբագրությունը ֆայլով',
    index: 'Բոլոր փաստաթղթերը',
    title: 'Իրավական տեղեկատվություն',
  },
};

const LANGUAGE_LABELS: Record<string, string> = { ru: 'Русский', hy: 'Հայերեն' };

/**
 * The legal texts as web pages, at addresses a store listing can point at.
 *
 * ## Why these paths and not `/legal/documents/...`
 *
 * `/legal/privacy` and `/legal/account-deletion` are already written into the
 * app-store listings and into the panels' footers. They used to serve two
 * hand-written English HTML files carrying `[OPERATOR]`-style placeholders —
 * a second set of legal texts, separate from the package the app shows and
 * the customer consents to. Two sets is how a product ends up promising one
 * thing in the app and another on the web, so the files are gone and these
 * paths now render the *same* published Markdown the app reads, at the same
 * revision, with the same checksum underneath it.
 *
 * ## What governs whether they answer
 *
 * The publication gate, and nothing else. There is no separate "serve the web
 * pages" switch any more: a text that may not be published to a customer in
 * the app may not be published to a store reviewer either, and a second
 * switch could only ever disagree with the first. While the gate is closed
 * every route here is a 404 — which is the honest answer, and better than a
 * page full of unfilled fields.
 *
 * ## The one place this differs from the app's own API
 *
 * `GET /legal/documents?lang=en` is a 400 with the list of real languages: an
 * app can act on that. A browser cannot, so a page asked for in a language
 * the texts do not exist in is served in the first published language with
 * the switcher in plain sight, rather than refused. Nothing is presented as
 * being in a language it is not — the `lang` attribute and the switcher both
 * say what is actually on the page.
 */
@ApiTags('legal')
@Public()
@Controller({ path: 'legal', version: VERSION_NEUTRAL })
export class LegalController {
  constructor(private readonly documents: LegalDocumentsService) {}

  @Get()
  index(@Res() res: Response, @Query('lang') lang?: string) {
    this.assertVisible();
    const language = this.resolveLanguage(lang);
    const strings = STRINGS[language] ?? STRINGS.ru!;
    const items = this.documents
      .listDocuments(language)
      .map((text) => `- [${text.title}](${this.href(text.key, language)})`)
      .join('\n');

    if (items.length === 0) throw this.notPublished();

    this.send(res, {
      title: strings.title,
      language,
      languages: this.languages(language, ''),
      bodyHtml: markdownToHtml(`# ${strings.title}\n\n${items}`),
      revision: this.documents.revision,
      contentHash: '',
      isDraft: !this.documents.isPublished(),
      fileHref: `/legal/documents?lang=${language}`,
      strings: { ...strings, checksum: '', indexHref: this.href('', language) },
    });
  }

  /** The address in the app-store listing. Kept exactly as it was. */
  @Get('privacy')
  privacy(@Res() res: Response, @Query('lang') lang?: string) {
    return this.page('privacy', res, lang);
  }

  /** The address Google Play requires to be reachable without the app. */
  @Get('account-deletion')
  accountDeletion(@Res() res: Response, @Query('lang') lang?: string) {
    return this.page('account-deletion', res, lang);
  }

  @Get('terms')
  terms(@Res() res: Response, @Query('lang') lang?: string) {
    return this.page('terms', res, lang);
  }

  @Get('bonus-refunds')
  bonusRefunds(@Res() res: Response, @Query('lang') lang?: string) {
    return this.page('bonus-refunds', res, lang);
  }

  @Get('consent')
  consent(@Res() res: Response, @Query('lang') lang?: string) {
    return this.page('consent', res, lang);
  }

  private page(key: string, res: Response, lang?: string) {
    this.assertVisible();
    const language = this.resolveLanguage(lang);
    const text = this.documents.getCurrent(key, language);
    if (!text) throw this.notPublished();

    const strings = STRINGS[language] ?? STRINGS.ru!;
    this.send(res, {
      title: text.title,
      language,
      languages: this.languages(language, key),
      bodyHtml: markdownToHtml(text.content),
      revision: text.revision,
      contentHash: text.contentHash,
      isDraft: text.isDraft,
      fileHref: `/legal/documents/${key}/file?lang=${language}`,
      strings: { ...strings, indexHref: this.href('', language) },
    });
  }

  private send(res: Response, params: Parameters<typeof legalPage>[0]) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A draft in preview must not be cached anywhere; a published text is
    // stable for the life of its revision, and a new revision is a new
    // document rather than an edit of this one.
    res.setHeader('Cache-Control', params.isDraft ? 'no-store' : 'public, max-age=300');
    // Overrides helmet's default for this response only. The page is
    // self-contained — no network, no frames, no forms — which is the only
    // reason a policy this narrow renders at all.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    res.status(200).send(legalPage(params));
  }

  private href(key: string, language: string): string {
    return key ? `/legal/${key}?lang=${language}` : `/legal?lang=${language}`;
  }

  private languages(current: string, key: string) {
    return this.documents.languages().map((code) => ({
      code,
      label: LANGUAGE_LABELS[code] ?? code,
      href: this.href(key, code),
      current: code === current,
    }));
  }

  private resolveLanguage(lang?: string): string {
    const available = this.documents.languages();
    return lang && available.includes(lang) ? lang : (available[0] ?? 'ru');
  }

  private assertVisible(): void {
    if (!this.documents.isVisible()) throw this.notPublished();
  }

  private notPublished(): NotFoundException {
    return new NotFoundException({
      message: 'The legal documents are not published yet',
      code: 'LEGAL_NOT_PUBLISHED',
    });
  }
}
