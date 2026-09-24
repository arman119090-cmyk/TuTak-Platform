import type { APIRoute } from 'astro';
import {
  RateLimiter,
  clientIp,
  formatLeadMessage,
  sendToTelegram,
  validateLead,
  type LeadErrorCode,
} from '../../lib/lead.ts';
import { isLocale, t, type Locale } from '../../i18n';

// Единственный серверный маршрут сайта.
export const prerender = false;

const limiter = new RateLimiter(5, 10 * 60 * 1000);
// Страховка на случай, если IP всё-таки удастся подменять: не больше 30
// заявок за 10 минут со всего сайта. Для сайта-визитки это с запасом.
const globalLimiter = new RateLimiter(30, 10 * 60 * 1000);

const STATUS: Record<LeadErrorCode, number> = {
  invalid_name: 400,
  invalid_phone: 400,
  invalid_type: 400,
  no_consent: 400,
  rate_limited: 429,
  server_error: 502,
};

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const data = await request.json().catch(() => null);
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
    return out;
  }
  return {};
}

/**
 * Форма работает и без JavaScript: fetch из скрипта получает JSON, обычная
 * отправка формы — короткую HTML-страницу с результатом на языке посетителя.
 */
function respond(request: Request, locale: string, result: 'ok' | LeadErrorCode) {
  const status = result === 'ok' ? 200 : STATUS[result];
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  if (wantsJson) {
    return new Response(JSON.stringify({ ok: result === 'ok', code: result }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const l: Locale = isLocale(locale) ? locale : 'hy';
  const d = t(l);
  const message = escapeHtml(d.lead.messages[result]);
  const html = `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>ElGo</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2EFEA;color:#16161A;font:17px/1.6 system-ui,sans-serif;padding:24px}main{max-width:560px}a{display:inline-block;margin-top:24px;padding:16px 28px;background:#B8925A;color:#16161A;text-decoration:none;border-radius:2px}</style></head><body><main><p>${message}</p><a href="/${l}/#contact">${escapeHtml(d.notFound.back)}</a></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const body = await readBody(request);
  const locale = typeof body.locale === 'string' ? body.locale : 'hy';

  const result = validateLead(body);
  if (!result.ok) return respond(request, locale, result.error);
  if (result.spam) return respond(request, locale, 'ok');

  // Лимит считаем только по заявкам, которые реально ушли бы в чат:
  // опечатки в форме не должны блокировать человека.
  let ip: string | undefined;
  try {
    ip = clientAddress;
  } catch {
    ip = undefined;
  }
  const key = clientIp(request.headers, ip, process.env.CLIENT_IP_HEADER || undefined);
  if (!limiter.take(key) || !globalLimiter.take('*')) {
    return respond(request, locale, 'rate_limited');
  }

  const text = formatLeadMessage(result.lead);

  if (process.env.LEAD_DRY_RUN === '1') {
    console.info('[lead] LEAD_DRY_RUN=1, в Telegram не отправлено:\n' + text);
    return respond(request, locale, 'ok');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    // Заявку некуда доставить — честно отвечаем ошибкой, а не «успехом».
    console.error('[lead] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — заявка не доставлена');
    return respond(request, locale, 'server_error');
  }

  try {
    await sendToTelegram({ token, chatId }, text);
  } catch (err) {
    console.error('[lead] ошибка отправки в Telegram:', err instanceof Error ? err.message : err);
    return respond(request, locale, 'server_error');
  }
  return respond(request, locale, 'ok');
};

export const ALL: APIRoute = () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
