/**
 * Заявка с сайта: валидация, антиспам, отправка в Telegram.
 *
 * Модуль без импортов из Astro — его напрямую гоняют тесты (`npm test`).
 */

export const OBJECT_TYPES = ['residential', 'commercial', 'renovation', 'infrastructure'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export type LeadErrorCode =
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_type'
  | 'no_consent'
  | 'rate_limited'
  | 'server_error';

export interface Lead {
  name: string;
  phone: string; // нормализованный, +374XXXXXXXX
  type: ObjectType;
  locale: string;
}

export type ValidationResult =
  | { ok: true; lead: Lead; spam: false }
  | { ok: true; spam: true }
  | { ok: false; error: LeadErrorCode };

/**
 * Приводит армянский номер к виду +374XXXXXXXX. Принимает «+374 43 357 007»,
 * «374 43 357007», «043 357 007», «(043) 35-70-07». Всё остальное — null.
 */
export function normalizeArmenianPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  let national: string;
  if (digits.startsWith('374') && digits.length === 11) {
    national = digits.slice(3);
  } else if (!hasPlus && digits.startsWith('00374') && digits.length === 13) {
    national = digits.slice(5);
  } else if (!hasPlus && digits.startsWith('0') && digits.length === 9) {
    national = digits.slice(1);
  } else {
    return null;
  }
  // Национальный номер: 8 цифр, первая — не 0 (код оператора/города).
  if (!/^[1-9]\d{7}$/.test(national)) return null;
  return `+374${national}`;
}

function field(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

/** Проверка входных данных. Заполненная ловушка — это «успех» без отправки. */
export function validateLead(input: Record<string, unknown>): ValidationResult {
  // Honeypot: люди это поле не видят. Боту отвечаем как будто всё хорошо,
  // чтобы он не подбирал обход.
  if (field(input, 'website').trim() !== '') return { ok: true, spam: true };

  const name = field(input, 'name').replace(/\s+/g, ' ').trim();
  const nameLength = [...name].length;
  if (nameLength < 2 || nameLength > 80) return { ok: false, error: 'invalid_name' };
  // Имя из одних цифр/знаков — не имя.
  if (!/\p{L}/u.test(name)) return { ok: false, error: 'invalid_name' };

  const phone = normalizeArmenianPhone(field(input, 'phone'));
  if (!phone) return { ok: false, error: 'invalid_phone' };

  const type = field(input, 'type');
  if (!(OBJECT_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'invalid_type' };

  const consent = input.consent;
  if (!(consent === true || consent === 'on' || consent === 'true' || consent === '1')) {
    return { ok: false, error: 'no_consent' };
  }

  const locale = ['hy', 'ru', 'en'].includes(field(input, 'locale')) ? field(input, 'locale') : 'hy';

  return { ok: true, spam: false, lead: { name, phone, type: type as ObjectType, locale } };
}

/**
 * Ограничение частоты по IP: не больше `limit` заявок за `windowMs`.
 *
 * Хранится в памяти процесса: сбрасывается при рестарте и не делится между
 * несколькими инстансами. Для сайта-визитки на одном инстансе этого
 * достаточно; при масштабировании — вынести в Redis.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  // Без parameter properties: тесты запускают этот файл через Node strip-types.
  constructor(limit = 5, windowMs = 10 * 60 * 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** true — можно; false — лимит исчерпан. Попытка засчитывается только если разрешена. */
  take(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.sweep(since);
    return true;
  }

  /** Убирает IP, у которых все попытки старше окна, — чтобы память не росла. */
  private sweep(since: number) {
    if (this.hits.size < 1000) return;
    for (const [key, list] of this.hits) {
      if (list.every((ts) => ts <= since)) this.hits.delete(key);
    }
  }

  get size() {
    return this.hits.size;
  }
}

const TYPE_LABELS_RU: Record<ObjectType, string> = {
  residential: 'Жилое строительство',
  commercial: 'Коммерческие и промышленные объекты',
  renovation: 'Ремонт и отделка под ключ',
  infrastructure: 'Дороги и инфраструктура',
};

const LOCALE_LABELS: Record<string, string> = { hy: 'армянский', ru: 'русский', en: 'английский' };

/** Текст сообщения в рабочий чат. Обычный текст, без parse_mode — нечего экранировать. */
export function formatLeadMessage(lead: Lead, receivedAt = new Date()): string {
  const when = receivedAt.toLocaleString('ru-RU', { timeZone: 'Asia/Yerevan' });
  return [
    'Новая заявка с сайта ElGo',
    '',
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    `Тип объекта: ${TYPE_LABELS_RU[lead.type]}`,
    `Язык сайта: ${LOCALE_LABELS[lead.locale] ?? lead.locale}`,
    `Время (Ереван): ${when}`,
  ].join('\n');
}

export interface TelegramConfig {
  token: string;
  chatId: string;
}

/** Отправка в Telegram Bot API. Бросает исключение при любой неудаче. */
export async function sendToTelegram(
  cfg: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Тело ответа Telegram не содержит токена — его можно логировать.
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * IP клиента для лимита частоты.
 *
 * Любой заголовок, которого не перезаписывает прокси платформы, клиент может
 * подделать и обойти лимит. Поэтому по умолчанию берём ПОСЛЕДНИЙ адрес
 * X-Forwarded-For — его дописывает ближайший к приложению прокси (Render,
 * Railway), — а без заголовка адрес сокета. Если платформа кладёт реальный IP
 * в свой заголовок, его имя задаётся через CLIENT_IP_HEADER.
 */
export function clientIp(headers: Headers, fallback: string | undefined, trustedHeader?: string): string {
  if (trustedHeader) {
    const v = headers.get(trustedHeader)?.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (v) return v;
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const last = xff.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return fallback || 'unknown';
}
