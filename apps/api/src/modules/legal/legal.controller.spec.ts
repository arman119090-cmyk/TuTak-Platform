import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LegalController } from './legal.controller';

function controller(enabled: boolean) {
  const config = { get: (key: string) => (key === 'legalPages' ? { enabled } : undefined) } as unknown as ConfigService<never, true>;
  return new LegalController(config as never);
}

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

describe('LegalController', () => {
  it('answers 404 for both pages until LEGAL_PAGES_ENABLED=true', () => {
    const c = controller(false);
    const { res } = response();
    expect(() => c.privacy(res as never)).toThrow(NotFoundException);
    expect(() => c.accountDeletion(res as never)).toThrow(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('serves the self-contained HTML with a narrow CSP once enabled', () => {
    const c = controller(true);
    for (const [page, title] of [
      ['privacy', 'Privacy Policy'],
      ['accountDeletion', 'Delete'],
    ] as const) {
      const { res, headers } = response();
      (c[page] as (r: unknown) => void)(res);
      expect(res.status).toHaveBeenCalledWith(200);
      const html = (res.send as jest.Mock).mock.calls[0]![0] as string;
      expect(html).toContain('<!doctype html>');
      expect(html).toContain(title);
      expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    }
  });

  it('the pages make no external requests (the CSP is only safe because of this)', () => {
    const c = controller(true);
    const { res } = response();
    c.privacy(res as never);
    const html = (res.send as jest.Mock).mock.calls[0]![0] as string;
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/i);
  });
});
