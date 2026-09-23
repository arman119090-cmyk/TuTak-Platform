"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { b, fail, ok, optText, s, type ActionState } from "@/lib/admin/forms";
import { LOCALES } from "@/lib/admin/format";
import { revalidateStore } from "@/lib/admin/revalidate";

const tr = z.object({ title: optText(160), body: optText(50_000), seoDescription: optText(170) });

export async function savePage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const pageId = s(fd, "pageId");
    if (!pageId) return fail("Нет страницы");
    const rows: ({ locale: (typeof LOCALES)[number] } & z.output<typeof tr>)[] = [];
    for (const l of LOCALES) {
      // Body keeps its inner whitespace (paragraph breaks); only edges are trimmed.
      const { data, error } = parse(tr, { title: s(fd, `${l}_title`), body: s(fd, `${l}_body`), seoDescription: s(fd, `${l}_seoDescription`) });
      if (error) return fail(`${l.toUpperCase()}: ${error.message}`);
      if ((data.title && !data.body) || (!data.title && (data.body || data.seoDescription)))
        return fail(`${l.toUpperCase()}: нужны и заголовок, и текст (или оставьте язык пустым)`);
      rows.push({ locale: l, ...data });
    }
    const legalReviewRequired = b(fd, "legalReviewRequired");
    await db.$transaction(async (tx) => {
      await tx.page.update({ where: { id: pageId }, data: { legalReviewRequired } });
      for (const r of rows) {
        if (!r.title || !r.body) {
          await tx.pageTranslation.deleteMany({ where: { pageId, locale: r.locale } });
          continue;
        }
        const values = { title: r.title, body: r.body.replace(/\r\n/g, "\n"), seoDescription: r.seoDescription };
        await tx.pageTranslation.upsert({
          where: { pageId_locale: { pageId, locale: r.locale } },
          create: { pageId, locale: r.locale, ...values },
          update: values,
        });
      }
      await audit(
        { actor: admin.email, action: "page.update", entity: "Page", entityId: pageId, data: { legalReviewRequired, locales: rows.filter((r) => r.title).map((r) => r.locale) } },
        tx,
      );
    });
    revalidateStore();
    return ok();
  });
}
