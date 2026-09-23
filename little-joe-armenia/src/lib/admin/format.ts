import { formatAmd } from "@/lib/money";

// Russian labels and formatting for the back office.

export const amd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatAmd(n, "ru"));

export function dt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Yerevan",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const LOCALES = ["hy", "ru", "it", "en"] as const;
export type AdminLocale = (typeof LOCALES)[number];
export const LOCALE_LABEL: Record<AdminLocale, string> = { hy: "HY", ru: "RU", it: "IT", en: "EN" };

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Новый (оплата при получении)",
  AWAITING_PAYMENT: "Ожидает оплаты",
  PAID: "Оплачен",
  PAYMENT_FAILED: "Оплата не прошла",
  CONFIRMED: "Подтверждён",
  PACKING: "Сборка",
  SHIPPED: "Передан в доставку",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
  REFUNDED: "Возврат",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  NOT_REQUIRED: "Не требуется",
  PENDING: "Ожидается",
  SUCCEEDED: "Получена",
  FAILED: "Ошибка",
  REFUNDED: "Возвращена",
};

export const PROVIDER_LABEL: Record<string, string> = {
  CASH_ON_DELIVERY: "Наличными при получении",
  IDRAM: "Idram",
  TELCELL: "Telcell",
  BANK_CARD: "Банковская карта",
};

export const PUBLISH_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  ACTIVE: "Опубликован",
  ARCHIVED: "В архиве",
};

export const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Не проверено",
  PENDING_REVIEW: "На проверке",
  VERIFIED: "Подтверждено",
  REJECTED: "Отклонено",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  MANUFACTURER_WEBSITE: "Сайт производителя",
  MANUFACTURER_CATALOG_PDF: "Каталог производителя (PDF)",
  MANUFACTURER_PRICE_LIST: "Прайс производителя",
  DISTRIBUTOR_DOCUMENT: "Документ дистрибьютора",
  PACKAGING: "Упаковка",
  RETAILER_LISTING: "Карточка у ритейлера",
  TASK_BRIEF: "Техзадание",
  INTERNAL: "Внутреннее",
};

export const FORMAT_LABEL: Record<string, string> = {
  VENT_CLIP: "На дефлектор",
  HANGING: "Подвесной",
  BOTTLE: "Флакон",
  PAPER: "Картонный",
  OTHER: "Другое",
};

export const MEDIA_KIND_LABEL: Record<string, string> = {
  PRODUCT: "Товар",
  PACKAGING: "Упаковка",
  INSTALLED: "В машине",
  DETAIL: "Деталь",
  LIFESTYLE: "Лайфстайл",
  HERO: "Hero",
};

export const MEDIA_RIGHTS_LABEL: Record<string, string> = {
  PLACEHOLDER: "Заглушка",
  AUTHORIZED: "Права подтверждены",
  UNCONFIRMED: "Права не подтверждены",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  PURCHASE: "Поступление",
  SALE: "Продажа",
  RESERVE: "Резерв",
  RELEASE: "Снятие резерва",
  CANCEL_RETURN: "Возврат при отмене",
  MANUAL_ADJUSTMENT: "Ручная корректировка",
  REFUND: "Возврат денег",
  RETURN_TO_STOCK: "Возврат на склад",
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Владелец",
  MANAGER: "Менеджер",
  CONTENT: "Контент",
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  PENDING: "На модерации",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
};

export const REGION_LABEL: Record<string, string> = {
  ER: "Ереван",
  AG: "Арагацотн",
  AR: "Арарат",
  AV: "Армавир",
  GR: "Гехаркуник",
  KT: "Котайк",
  LO: "Лори",
  SH: "Ширак",
  SU: "Сюник",
  TV: "Тавуш",
  VD: "Вайоц Дзор",
};

export function tone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (["PAID", "CONFIRMED", "DELIVERED", "SUCCEEDED", "ACTIVE", "VERIFIED", "APPROVED", "ACCEPTED", "AUTHORIZED"].includes(status))
    return "ok";
  if (["PAYMENT_FAILED", "CANCELLED", "FAILED", "REJECTED", "UNCONFIRMED"].includes(status)) return "bad";
  if (["PENDING", "AWAITING_PAYMENT", "PACKING", "SHIPPED", "PENDING_REVIEW", "OPEN", "DRAFT", "PLACEHOLDER"].includes(status))
    return "warn";
  return "muted";
}
