import "server-only";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/** Resolves the [locale] route param or 404s. */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}

export async function localeAndMessages(params: Promise<{ locale: string }>) {
  const locale = await resolveLocale(params);
  return { locale, m: getMessages(locale) };
}
