"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, ok, optText, optUrl, reqInt, reqText, s, type ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

const schema = z
  .object({
    sortOrder: reqInt(-10000, 10000),
    sourceUrl: optUrl,
    sourceType: z.enum([
      "MANUFACTURER_WEBSITE",
      "MANUFACTURER_CATALOG_PDF",
      "MANUFACTURER_PRICE_LIST",
      "DISTRIBUTOR_DOCUMENT",
      "PACKAGING",
      "RETAILER_LISTING",
      "TASK_BRIEF",
      "INTERNAL",
    ]),
    verification: z.enum(["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "REJECTED"]),
    titleHy: reqText(200, "Заголовок HY"),
    titleRu: reqText(200, "Заголовок RU"),
    titleIt: reqText(200, "Заголовок IT"),
    titleEn: reqText(200, "Заголовок EN"),
    bodyHy: optText(2000),
    bodyRu: optText(2000),
    bodyIt: optText(2000),
    bodyEn: optText(2000),
  })
  .refine((c) => c.verification !== "VERIFIED" || c.sourceUrl !== null, {
    message: "Для статуса «Подтверждено» нужна ссылка на источник",
    path: ["sourceUrl"],
  });

export async function saveClaim(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const claimId = s(fd, "claimId");
    if (!claimId) return fail("Нет заявления");
    const keys = ["sourceUrl", "sourceType", "verification", "titleHy", "titleRu", "titleIt", "titleEn", "bodyHy", "bodyRu", "bodyIt", "bodyEn"];
    const { data, error } = parse(schema, { ...Object.fromEntries(keys.map((k) => [k, s(fd, k)])), sortOrder: s(fd, "sortOrder") ?? "0" });
    if (error) return error;
    await db.$transaction(async (tx) => {
      const prev = await tx.brandClaim.findUniqueOrThrow({ where: { id: claimId } });
      const verifiedAt = data.verification !== "VERIFIED" ? null : prev.verification === "VERIFIED" && prev.verifiedAt ? prev.verifiedAt : new Date();
      await tx.brandClaim.update({ where: { id: claimId }, data: { ...data, verifiedAt } });
      await audit(
        { actor: admin.email, action: "brand_claim.update", entity: "BrandClaim", entityId: claimId, data: { key: prev.key, from: prev.verification, ...data } },
        tx,
      );
    });
    revalidateStore();
    return ok(data.verification === "VERIFIED" ? "Сохранено — заявление показывается на сайте" : "Сохранено — на сайте не показывается (не подтверждено)");
  });
}
