"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/security/password";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, isUniqueViolation, ok, s, type ActionState } from "@/lib/admin/forms";

export async function createAdminUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("users", async (admin) => {
    const { data, error } = parse(
      z.object({
        email: z.string({ error: "Email обязателен" }).trim().toLowerCase().email("Некорректный email").max(200),
        name: z.string({ error: "Имя обязательно" }).min(1, "Имя обязательно").max(120),
        role: z.enum(["OWNER", "MANAGER", "CONTENT"]),
        password: z.string({ error: "Пароль обязателен" }).trim().min(12, "Пароль: минимум 12 символов").max(200),
      }),
      { email: s(fd, "email"), name: s(fd, "name"), role: s(fd, "role"), password: fd.get("password") },
    );
    if (error) return error;
    const passwordHash = await hashPassword(data.password);
    try {
      await db.$transaction(async (tx) => {
        const u = await tx.adminUser.create({ data: { email: data.email, name: data.name, role: data.role, passwordHash } });
        await audit({ actor: admin.email, action: "admin_user.create", entity: "AdminUser", entityId: u.id, data: { email: u.email, role: u.role } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("Администратор с таким email уже есть");
      throw e;
    }
    return ok(`Создан ${data.email}`);
  });
}

export async function setAdminActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("users", async (admin) => {
    const { data, error } = parse(z.object({ userId: z.string().min(1).max(40), active: z.enum(["0", "1"]) }), {
      userId: s(fd, "userId"),
      active: s(fd, "active"),
    });
    if (error) return error;
    if (data.userId === admin.id) return fail("Нельзя отключить самого себя");
    const isActive = data.active === "1";
    await db.$transaction(async (tx) => {
      const u = await tx.adminUser.update({ where: { id: data.userId }, data: { isActive } });
      // Deactivation also ends every open session immediately.
      if (!isActive) await tx.adminSession.deleteMany({ where: { adminId: u.id } });
      await audit({ actor: admin.email, action: isActive ? "admin_user.activate" : "admin_user.deactivate", entity: "AdminUser", entityId: u.id, data: { email: u.email } }, tx);
    });
    return ok(isActive ? "Доступ восстановлен" : "Доступ отключён, сессии завершены");
  });
}
