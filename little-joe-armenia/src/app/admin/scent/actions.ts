"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, ok, optHex, optText, reqInt, s, slugSchema, type ActionState } from "@/lib/admin/forms";
import { LOCALES } from "@/lib/admin/format";
import { revalidateStore } from "@/lib/admin/revalidate";

// Fragrance families and scent tags. Open to every admin role ("scent").

const familySchema = z.object({
  slug: slugSchema,
  sortOrder: reqInt(-10000, 10000),
  accentColor: optHex,
  tr: z.object(
    Object.fromEntries(LOCALES.map((l) => [l, z.object({ name: optText(80), description: optText(1000) })])) as Record<
      (typeof LOCALES)[number],
      z.ZodObject<{ name: ReturnType<typeof optText>; description: ReturnType<typeof optText> }>
    >,
  ),
});

export async function saveFamily(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("scent", async (admin) => {
    const familyId = s(fd, "familyId");
    const { data, error } = parse(familySchema, {
      slug: s(fd, "slug"),
      sortOrder: s(fd, "sortOrder") ?? "0",
      accentColor: s(fd, "accentColor"),
      tr: Object.fromEntries(LOCALES.map((l) => [l, { name: s(fd, `${l}_name`), description: s(fd, `${l}_description`) }])),
    });
    if (error) return error;
    for (const l of LOCALES) if (!data.tr[l].name && data.tr[l].description) return fail(`${l.toUpperCase()}: название обязательно, если есть описание`);
    await db.$transaction(async (tx) => {
      const { tr, ...fields } = data;
      const row = familyId ? await tx.fragranceFamily.update({ where: { id: familyId }, data: fields }) : await tx.fragranceFamily.create({ data: fields });
      for (const l of LOCALES) {
        const t = tr[l];
        if (!t.name) {
          await tx.fragranceFamilyTranslation.deleteMany({ where: { familyId: row.id, locale: l } });
          continue;
        }
        await tx.fragranceFamilyTranslation.upsert({
          where: { familyId_locale: { familyId: row.id, locale: l } },
          create: { familyId: row.id, locale: l, name: t.name, description: t.description },
          update: { name: t.name, description: t.description },
        });
      }
      await audit({ actor: admin.email, action: familyId ? "family.update" : "family.create", entity: "FragranceFamily", entityId: row.id, data: { ...fields, tr } }, tx);
    });
    revalidateStore();
    return ok(familyId ? "Семейство сохранено" : "Семейство добавлено");
  });
}

export async function deleteFamily(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("scent", async (admin) => {
    const familyId = s(fd, "familyId");
    if (!familyId) return fail("Нет семейства");
    const used = await db.product.count({ where: { familyId } });
    if (used > 0) return fail(`Семейство назначено ${used} товар(ам) — сначала снимите его с товаров.`);
    await db.$transaction(async (tx) => {
      const f = await tx.fragranceFamily.delete({ where: { id: familyId } });
      await audit({ actor: admin.email, action: "family.delete", entity: "FragranceFamily", entityId: familyId, data: { slug: f.slug } }, tx);
    });
    revalidateStore();
    return ok("Удалено");
  });
}

export async function saveTag(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("scent", async (admin) => {
    const tagId = s(fd, "tagId");
    const { data, error } = parse(
      z.object({ slug: slugSchema, names: z.object(Object.fromEntries(LOCALES.map((l) => [l, optText(60)])) as Record<(typeof LOCALES)[number], ReturnType<typeof optText>>) }),
      { slug: s(fd, "slug"), names: Object.fromEntries(LOCALES.map((l) => [l, s(fd, `${l}_name`)])) },
    );
    if (error) return error;
    await db.$transaction(async (tx) => {
      const row = tagId ? await tx.scentTag.update({ where: { id: tagId }, data: { slug: data.slug } }) : await tx.scentTag.create({ data: { slug: data.slug } });
      for (const l of LOCALES) {
        const name = data.names[l];
        if (!name) {
          await tx.scentTagTranslation.deleteMany({ where: { tagId: row.id, locale: l } });
          continue;
        }
        await tx.scentTagTranslation.upsert({
          where: { tagId_locale: { tagId: row.id, locale: l } },
          create: { tagId: row.id, locale: l, name },
          update: { name },
        });
      }
      await audit({ actor: admin.email, action: tagId ? "scent_tag.update" : "scent_tag.create", entity: "ScentTag", entityId: row.id, data }, tx);
    });
    revalidateStore();
    return ok(tagId ? "Тег сохранён" : "Тег добавлен");
  });
}

export async function deleteTag(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("scent", async (admin) => {
    const tagId = s(fd, "tagId");
    if (!tagId) return fail("Нет тега");
    await db.$transaction(async (tx) => {
      // ProductScentTag rows cascade: the tag disappears from products too.
      const t = await tx.scentTag.delete({ where: { id: tagId } });
      await audit({ actor: admin.email, action: "scent_tag.delete", entity: "ScentTag", entityId: tagId, data: { slug: t.slug } }, tx);
    });
    revalidateStore();
    return ok("Удалено");
  });
}
