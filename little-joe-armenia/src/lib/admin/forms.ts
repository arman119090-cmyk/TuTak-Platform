import { z } from "zod";

// FormData → typed values for admin Server Actions. Every action runs its
// input through a Zod schema; these helpers only turn raw form strings into
// the shapes the schemas expect ("" → null, "on" → true, …).

export type ActionState = { ok: boolean; message: string } | null;

export const ok = (message = "Сохранено"): ActionState => ({ ok: true, message });
export const fail = (message: string): ActionState => ({ ok: false, message });

/** Trimmed string or null when empty/missing. */
export function s(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Checkbox. */
export function b(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

/** All non-empty string values of a multi-value field. */
export function list(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Zod: optional integer from a form string ("" → null). */
export const optInt = (min?: number, max?: number) => {
  let n = z.coerce.number().int("Нужно целое число");
  if (min !== undefined) n = n.min(min, `Не меньше ${min}`);
  if (max !== undefined) n = n.max(max, `Не больше ${max}`);
  return z.preprocess((v) => (v === null || v === undefined || v === "" ? null : v), n.nullable());
};

export const reqInt = (min?: number, max?: number) => {
  let n = z.coerce.number({ error: "Нужно число" }).int("Нужно целое число");
  if (min !== undefined) n = n.min(min, `Не меньше ${min}`);
  if (max !== undefined) n = n.max(max, `Не больше ${max}`);
  return z.preprocess((v) => (v === null || v === undefined || v === "" ? undefined : v), n);
};

export const optText = (max: number) => z.string().max(max, `Не длиннее ${max} символов`).nullable();
export const reqText = (max: number, what = "Поле") =>
  z.string({ error: `${what}: обязательно` }).min(1, `${what}: обязательно`).max(max, `Не длиннее ${max} символов`);

export const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const optHex = z
  .string()
  .regex(HEX, "Цвет в формате #RRGGBB")
  .nullable();

export const slugSchema = z
  .string({ error: "Slug обязателен" })
  .min(2, "Slug: минимум 2 символа")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: только a-z, 0-9 и дефисы");

export const optUrl = z
  .string()
  .max(500)
  .refine((v) => /^https?:\/\//.test(v), "Ссылка должна начинаться с http(s)://")
  .nullable();

const FIELD_LABEL: Record<string, string> = {
  slug: "Slug",
  sku: "SKU",
  label: "Подпись",
  priceAmd: "Цена",
  compareAtAmd: "Старая цена",
  lowStockAt: "Порог",
  sortOrder: "Порядок",
  accentColor: "Акцентный цвет",
  accentInk: "Цвет текста",
  articleNumber: "Артикул",
  ean: "EAN",
  durationDays: "Срок действия",
  dimensions: "Размеры",
  colorName: "Цвет",
  intensity: "Интенсивность",
  sweetness: "Сладость",
  freshness: "Свежесть",
  woodiness: "Древесность",
  fruity: "Фруктовость",
  floral: "Цветочность",
  url: "URL",
  width: "Ширина",
  height: "Высота",
  delta: "Изменение",
  value: "Значение",
  code: "Код",
  name: "Название",
  startsAt: "Начало",
  endsAt: "Окончание",
  minSubtotalAmd: "Мин. сумма",
  usageLimit: "Лимит",
  href: "Ссылка",
  sourceUrl: "Ссылка на источник",
  freeFromAmd: "Бесплатно от",
  email: "Email",
  password: "Пароль",
  body: "Текст",
  note: "Комментарий",
};

/** First Zod issue as a readable message. */
export function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "Некорректные данные";
  const key = i.path.map(String).join(".");
  if (!key) return i.message;
  const label = FIELD_LABEL[key] ?? key;
  // Messages that already name their field ("SKU: …", "EAN: …") are shown as is.
  return i.message.toLowerCase().startsWith(label.toLowerCase()) ? i.message : `${label}: ${i.message}`;
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

/**
 * <input type="datetime-local"> values are Yerevan wall time (UTC+4, no DST
 * since 2012).
 */
export function parseYerevanLocal(v: string | null): Date | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+04:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYerevanLocal(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 16);
}

/** EAN-8 / EAN-13 with GS1 check digit. */
export function isValidEan(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  // Weights 3,1,3,1… from the rightmost data digit.
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check;
}
