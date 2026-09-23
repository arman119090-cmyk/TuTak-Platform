"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { verifyPassword } from "@/lib/security/password";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { endAdminSession, startAdminSession } from "@/lib/security/session";
import { requireAdmin } from "@/lib/admin/auth";
import { fail, type ActionState } from "@/lib/admin/forms";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

const GENERIC = "Неверный email или пароль";
// Verified against when the email is unknown so response time does not reveal
// which addresses have accounts. (Hash of a random, discarded password.)
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return fail(GENERIC);
  const { email, password } = parsed.data;
  const ip = await clientIp();

  const limit = await rateLimit("adminLogin", `${ip}|${email}`);
  if (!limit.ok) {
    await audit({ actor: email, action: "admin.login.rate_limited", entity: "AdminUser", ip });
    return fail(`Слишком много попыток входа. Повторите через ${Math.ceil(limit.retryAfterSec / 60)} мин.`);
  }

  const user = await db.adminUser.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH).catch(() => false);
  if (!user || !valid || !user.isActive) {
    await audit({
      actor: email,
      action: "admin.login.failure",
      entity: "AdminUser",
      entityId: user?.id ?? null,
      data: { reason: !user ? "unknown_email" : !valid ? "bad_password" : "inactive" },
      ip,
    });
    return fail(GENERIC);
  }

  await startAdminSession(user.id);
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actor: user.email, action: "admin.login.success", entity: "AdminUser", entityId: user.id, ip });

  const next = fd.get("next");
  // Only same-app admin paths; never an absolute or protocol-relative URL.
  const target = typeof next === "string" && /^\/admin(?:\/[\w\-/]*)?$/.test(next) ? next : "/admin";
  redirect(target);
}

export async function logoutAction() {
  const admin = await requireAdmin();
  await endAdminSession();
  await audit({ actor: admin.email, action: "admin.logout", entity: "AdminUser", entityId: admin.id, ip: await clientIp() });
  redirect("/admin/login");
}
