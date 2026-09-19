import { Controller, Get, NotFoundException, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/public.decorator';

/**
 * The public legal pages — privacy policy and account-deletion instructions —
 * served by the API itself.
 *
 * They live here, and not on a separate host, because both app stores need
 * a URL that answers without installing anything, this is the one service
 * with a stable public address, and standing up a static host for two HTML
 * files is a fourth thing to keep alive. The pages are self-contained (no
 * external requests), which is why the CSP below can be so narrow.
 *
 * Off by default. `LEGAL_PAGES_ENABLED=true` turns them on, and the switch
 * exists because the texts carry `[CONTACT EMAIL]`-style placeholders until a
 * lawyer has signed them off; a placeholder privacy policy on a public URL
 * is worse than a 404, which at least says "not yet".
 *
 * Version-neutral for the same reason `/health` is: a store listing points
 * at a fixed path, and `/v1/legal/privacy` breaking on the next API version
 * would break the listing with it.
 */
@Public()
@Controller({ path: 'legal', version: VERSION_NEUTRAL })
export class LegalController {
  private readonly enabled: boolean;
  private readonly pages: Record<string, string>;

  constructor(config: ConfigService<AppConfig, true>) {
    this.enabled = config.get('legalPages', { infer: true }).enabled;
    this.pages = this.enabled ? { privacy: this.load('privacy.html'), 'account-deletion': this.load('account-deletion.html') } : {};
  }

  @Get('privacy')
  privacy(@Res() res: Response) {
    return this.serve('privacy', res);
  }

  @Get('account-deletion')
  accountDeletion(@Res() res: Response) {
    return this.serve('account-deletion', res);
  }

  private serve(page: string, res: Response) {
    const html = this.pages[page];
    if (!this.enabled || html === undefined) {
      throw new NotFoundException('This page is not published yet');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    // Overrides helmet's default for this response only: the pages need
    // their own inline style and the one inline script that switches
    // language, and nothing else — no network, no frames, no forms.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    res.status(200).send(html);
  }

  private load(file: string): string {
    // Resolved relative to this file so it works from both `src/` (ts-node,
    // jest) and `dist/` (the container): two directories up is apps/api.
    return readFileSync(join(__dirname, '..', '..', '..', 'public', 'legal', file), 'utf8');
  }
}
