"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { requireAdmin } from "@/lib/admin/auth";
import { b, fail, isUniqueViolation, ok, optHex, optText, optUrl, reqInt, s, slugSchema, type ActionState } from "@/lib/admin/forms";
import { LOCALES } from "@/lib/admin/format";
import { revalidateAdmin, revalidateStore } from "@/lib/admin/revalidate";

const trSchema = z.object({
  name: optText(120),
  description: optText(2000),
  seoTitle: optText(70),
  seoDescription: optText(170),
});

const schema = z.object({
  slug: slugSchema,
  sortOrder: reqInt(-100000, 100000),
  isVisible: z.boolean(),
  accentColor: optHex,
  verification: z.enum(["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "REJECTED"]),
  sourceType: z
    .enum([
      "MANUFACTURER_WEBSITE",
      "MANUFACTURER_CATALOG_PDF",
      "MANUFACTURER_PRICE_LIST",
      "DISTRIBUTOR_DOCUMENT",
      "PACKAGING",
      "RETAILER_LISTING",
      "TASK_BRIEF",
      "INTERNAL",
    ])
    .nullable(),
  sourceUrl: optUrl,
  tr: z.object({ hy: trSchema, ru: trSchema, it: trSchema, en: trSchema }),
});

function input(fd: FormData) {
  return {
    slug: s(fd, "slug"),
    sortOrder: s(fd, "sortOrder") ?? "0",
    isVisible: b(fd, "isVisible"),
    accentColor: s(fd, "accentColor"),
    verification: s(fd, "verification") ?? "UNVERIFIED",
    sourceType: s(fd, "sourceType"),
    sourceUrl: s(fd, "sourceUrl"),
    tr: Object.fromEntries(
      LOCALES.map((l) => [
        l,
        { name: s(fd, `${l}_name`), description: s(fd, `${l}_description`), seoTitle: s(fd, `${l}_seoTitle`), seoDescription: s(fd, `${l}_seoDescription`) },
      ]),
    ),
  };
}

type Data = z.output<typeof schema>;

function check(data: Data): string | null {
  for (const l of LOCALES) {
    const t = data.tr[l];
    if (!t.name && (t.description || t.seoTitle || t.seoDescription)) return `${l.toUpperCase()}: название обязательно, если заполнены другие поля`;
  }
  if (data.verification === "VERIFIED" && !data.sourceType) return "Для статуса «Подтверждено» нужен источник";
  return null;
}

async function writeTranslations(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], collectionId: string, data: Data) {
  for (const l of LOCALES) {
    const t = data.tr[l];
    if (!t.name) {
      await tx.collectionTranslation.deleteMany({ where: { collectionId, locale: l } });
      continue;
    }
    const values = { ...t, name: t.name };
    await tx.collectionTranslation.upsert({
      where: { collectionId_locale: { collectionId, locale: l } },
      create: { collectionId, locale: l, ...values },
      update: values,
    });
  }
}

export async function createCollection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin("collections");
  const { data, error } = parse(schema, input(fd));
  if (error) return error;
  const problem = check(data);
  if (problem) return fail(problem);
  let newId: string;
  try {
    newId = await db.$transaction(async (tx) => {
      const { tr, ...fields } = data;
      const c = await tx.collection.create({ data: { ...fields, verifiedAt: fields.verification === "VERIFIED" ? new Date() : null } });
      await writeTranslations(tx, c.id, data);
      await audit({ actor: admin.email, action: "collection.create", entity: "Collection", entityId: c.id, data: { ...fields, tr } }, tx);
      return c.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Такой slug уже занят");
    throw e;
  }
  revalidateAdmin();
  revalidateStore();
  redirect(`/admin/collections/${newId}`);
}

export async function saveCollection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("collections", async (admin) => {
    const collectionId = s(fd, "collectionId");
    if (!collectionId) return fail("Нет коллекции");
    const { data, error } = parse(schema, input(fd));
    if (error) return error;
    const problem = check(data);
    if (problem) return fail(problem);
    await db.$transaction(async (tx) => {
      const prev = await tx.collection.findUniqueOrThrow({ where: { id: collectionId } });
      const { tr, ...fields } = data;
      const verifiedAt =
        fields.verification !== "VERIFIED" ? null : prev.verification === "VERIFIED" && prev.verifiedAt ? prev.verifiedAt : new Date();
      await tx.collection.update({ where: { id: collectionId }, data: { ...fields, verifiedAt } });
      await writeTranslations(tx, collectionId, data);
      await audit({ actor: admin.email, action: "collection.update", entity: "Collection", entityId: collectionId, data: { ...fields, tr } }, tx);
    });
    revalidateStore();
    return ok();
  });
}

export async function deleteCollection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin("collections");
  const collectionId = s(fd, "collectionId");
  if (!collectionId) return fail("Нет коллекции");
  const products = await db.product.count({ where: { collectionId } });
  if (products > 0) return fail(`В коллекции ${products} товар(ов). Перенесите их или скройте коллекцию.`);
  await db.$transaction(async (tx) => {
    const c = await tx.collection.delete({ where: { id: collectionId } });
    await audit({ actor: admin.email, action: "collection.delete", entity: "Collection", entityId: collectionId, data: { slug: c.slug } }, tx);
  });
  revalidateAdmin();
  revalidateStore();
  redirect("/admin/collections");
}
