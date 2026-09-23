import type { Locale } from "@/i18n/config";
import { en } from "@/i18n/messages/en";
import { hy } from "@/i18n/messages/hy";
import { it } from "@/i18n/messages/it";
import { ru } from "@/i18n/messages/ru";

/** Same keys as English, every value a string. */
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Messages = Shape<typeof en>;

export const dictionaries: Record<Locale, Messages> = { hy, ru, it, en };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

/** Replaces {name} placeholders. Values are inserted as text, never HTML. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}
