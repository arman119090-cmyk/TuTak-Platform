import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { requireAdmin, type AdminUserSession, type Area } from "@/lib/admin/auth";
import { fail, isUniqueViolation, zodMessage, type ActionState } from "@/lib/admin/forms";
import { revalidateAdmin } from "@/lib/admin/revalidate";

/**
 * Wraps an admin Server Action body:
 *  1. requireAdmin(area) — always first, outside any try/catch;
 *  2. unexpected errors become a generic message (details go to the log);
 *  3. the admin tree is revalidated after a successful mutation.
 */
export async function adminAction(
  area: Area,
  body: (admin: AdminUserSession) => Promise<ActionState>,
): Promise<ActionState> {
  const admin = await requireAdmin(area);
  try {
    const result = await body(admin);
    if (result?.ok) revalidateAdmin();
    return result;
  } catch (e) {
    unstable_rethrow(e); // redirect()/notFound() must propagate
    if (isUniqueViolation(e)) return fail("Такое значение уже существует (должно быть уникальным)");
    console.error("[admin action]", e);
    return fail("Не удалось сохранить. Попробуйте ещё раз или сообщите разработчику.");
  }
}

/** safeParse with a readable error. */
export function parse<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { data: z.output<T>; error: null } | { data: null; error: { ok: false; message: string } } {
  const r = schema.safeParse(input);
  if (r.success) return { data: r.data, error: null };
  return { data: null, error: { ok: false, message: zodMessage(r.error) } };
}
