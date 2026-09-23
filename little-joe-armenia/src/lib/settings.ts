import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/lib/db";

// Typed key/value settings edited in /admin/settings. Each key has a schema
// and a default, so a missing or malformed row never breaks the storefront.

export const settingSchemas = {
  contacts: z.object({
    phone: z.string().max(40).default(""),
    email: z.string().max(120).default(""),
    address: z.string().max(200).default(""),
    hours: z.string().max(120).default(""),
  }),
  social: z.object({
    instagram: z.string().max(200).default(""),
    facebook: z.string().max(200).default(""),
    tiktok: z.string().max(200).default(""),
    telegram: z.string().max(200).default(""),
  }),
  business: z.object({
    legalName: z.string().max(200).default(""),
    taxId: z.string().max(40).default(""),
    // Must be set by the owner once authorisation is documented.
    brandAuthorizationConfirmed: z.boolean().default(false),
  }),
  seo: z.object({
    titleSuffix: z.string().max(60).default("Little Joe Armenia"),
    ogImageUrl: z.string().max(300).default(""),
  }),
  analytics: z.object({
    ga4Id: z.string().max(40).default(""),
    metaPixelId: z.string().max(40).default(""),
    tiktokPixelId: z.string().max(40).default(""),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingSchemas)[K]>;

export const getSetting = cache(async <K extends SettingKey>(key: K): Promise<SettingValue<K>> => {
  const row = await db.setting.findUnique({ where: { key } });
  const parsed = settingSchemas[key].safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : settingSchemas[key].parse({})) as SettingValue<K>;
});
