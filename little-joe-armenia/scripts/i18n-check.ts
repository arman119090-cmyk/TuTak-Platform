/* Translation gate (`pnpm i18n:check`; run it in CI before deploy).
 *
 * 1. UI dictionaries: every locale has exactly the English key set, no empty
 *    strings, identical {placeholder} sets. (Missing keys also fail
 *    `tsc` through the `Messages` type.)
 * 2. Database content (when DATABASE_URL is reachable): every ACTIVE,
 *    non-demo product, visible collection, fragrance family and page must
 *    have a non-empty name/title in hy, ru, it and en. Any problem exits
 *    non-zero.
 */
import "dotenv/config";
import { en } from "../src/i18n/messages/en";
import { hy } from "../src/i18n/messages/hy";
import { ru } from "../src/i18n/messages/ru";
import { it } from "../src/i18n/messages/it";

type Tree = { [k: string]: string | Tree };
const LOCALES = { hy, ru, it } as Record<string, Tree>;
const problems: string[] = [];

function flatten(t: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const ref = flatten(en as unknown as Tree);
for (const [code, dict] of Object.entries(LOCALES)) {
  const flat = flatten(dict);
  for (const [k, v] of ref) {
    const t = flat.get(k);
    if (t === undefined) problems.push(`[ui:${code}] missing ${k}`);
    else if (t.trim() === "") problems.push(`[ui:${code}] empty ${k}`);
    else if (placeholders(t) !== placeholders(v)) problems.push(`[ui:${code}] placeholder mismatch ${k}`);
  }
  for (const k of flat.keys()) if (!ref.has(k)) problems.push(`[ui:${code}] unknown key ${k}`);
}
for (const [k, v] of ref) if (v.trim() === "") problems.push(`[ui:en] empty ${k}`);

async function checkDatabase() {
  if (!process.env.DATABASE_URL) return console.info("i18n: DATABASE_URL not set — database content not checked");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const all = ["hy", "ru", "it", "en"];
  const missing = (rows: { locale: string; value: string | null }[]) =>
    all.filter((l) => !rows.some((r) => r.locale === l && r.value && r.value.trim() !== ""));
  try {
    for (const p of await db.product.findMany({ where: { status: "ACTIVE", isDemo: false }, include: { translations: true } })) {
      const m = missing(p.translations.map((t) => ({ locale: t.locale, value: t.name })));
      if (m.length) problems.push(`[db] product ${p.slug}: name missing in ${m.join(",")}`);
    }
    for (const c of await db.collection.findMany({ where: { isVisible: true }, include: { translations: true } })) {
      const m = missing(c.translations.map((t) => ({ locale: t.locale, value: t.name })));
      if (m.length) problems.push(`[db] collection ${c.slug}: name missing in ${m.join(",")}`);
    }
    for (const f of await db.fragranceFamily.findMany({ include: { translations: true } })) {
      const m = missing(f.translations.map((t) => ({ locale: t.locale, value: t.name })));
      if (m.length) problems.push(`[db] family ${f.slug}: name missing in ${m.join(",")}`);
    }
    for (const p of await db.page.findMany({ include: { translations: true } })) {
      const m = missing(p.translations.map((t) => ({ locale: t.locale, value: t.body })));
      if (m.length) problems.push(`[db] page ${p.slug}: body missing in ${m.join(",")}`);
    }
  } catch (e) {
    console.warn(`i18n: database not reachable (${(e as Error).message.split("\n")[0]}) — skipped`);
  } finally {
    await db.$disconnect();
  }
}

void checkDatabase().then(() => {
  console.info(`i18n: ${ref.size} UI keys × 4 locales checked; ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  if (problems.length) process.exitCode = 1;
});
