import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import { LegalController } from './legal.controller';
import { LegalDocumentsService } from './legal-documents.service';

/**
 * The web pages a store listing points at.
 *
 * What is worth pinning here is not the markup but the two rules the markup
 * exists to carry: nothing is served while the publication gate is closed,
 * and what is served is the same text, at the same revision, that the app
 * shows and the customer consents to — not a second set of pages that can
 * drift away from it.
 */
describe('LegalController (web pages)', () => {
  const documents = (env: Partial<AppConfig['legalDocuments']> = {}) => {
    const config = {
      get: () => ({
        contentDir: null,
        approvedRevision: null,
        previewEnabled: false,
        consentRequired: true,
        ...env,
      }),
    } as unknown as ConfigService<AppConfig, true>;
    return new LegalDocumentsService(config);
  };

  const published = () =>
    documents({
      contentDir: join(__dirname, '..', '..', '..', 'test', 'fixtures', 'legal'),
      approvedRevision: '1.0-test-2026-09-22',
    });

  function response() {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    return { res, headers };
  }

  const html = (res: { send: jest.Mock }) => (res.send as jest.Mock).mock.calls[0]![0] as string;

  it('answers 404 on every page while the gate is closed', () => {
    const c = new LegalController(documents());
    const { res } = response();

    expect(() => c.privacy(res as never)).toThrow(NotFoundException);
    expect(() => c.accountDeletion(res as never)).toThrow(NotFoundException);
    expect(() => c.terms(res as never)).toThrow(NotFoundException);
    expect(() => c.index(res as never)).toThrow(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('serves the published text itself, with the revision and the checksum under it', () => {
    const service = published();
    const c = new LegalController(service);
    const { res, headers } = response();

    c.privacy(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    const page = html(res);
    expect(page).toContain('<!doctype html>');
    // The fixture's own words, rendered — not a second, hand-written text.
    expect(page).toContain('Тестовый текст');
    expect(page).toContain(service.getCurrent('privacy', 'ru')!.contentHash);
    expect(page).toContain('1.0-test-2026-09-22');
    expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('makes no external request, which is what makes that policy renderable', () => {
    const c = new LegalController(published());
    const { res } = response();
    c.terms(res as never);
    expect(html(res)).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/i);
  });

  it('serves a language the texts exist in when asked for one they do not', () => {
    const c = new LegalController(published());
    const { res } = response();

    c.privacy(res as never, 'en');

    // A browser cannot act on a 400, so it gets the first published language
    // and the switcher — and the page never claims to be English.
    expect(html(res)).toContain('<html lang="ru"');
    expect(html(res)).toContain('Հայերեն');
  });

  it('marks a draft as a draft and refuses to let it be cached', () => {
    const preview = documents({
      contentDir: join(__dirname, '..', '..', '..', 'test', 'fixtures', 'legal'),
      previewEnabled: true,
    });
    const c = new LegalController(preview);
    const { res, headers } = response();

    c.accountDeletion(res as never);

    expect(html(res)).toContain('Проект для согласования');
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('lists every document on the index, each at its own address', () => {
    const c = new LegalController(published());
    const { res } = response();

    c.index(res as never);

    for (const key of ['terms', 'privacy', 'bonus-refunds', 'consent', 'account-deletion']) {
      expect(html(res)).toContain(`/legal/${key}?lang=ru`);
    }
  });
});
