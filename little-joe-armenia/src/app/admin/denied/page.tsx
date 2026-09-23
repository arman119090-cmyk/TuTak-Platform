import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { ROLE_LABEL } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Нет доступа" };

export default async function DeniedPage() {
  const admin = await requireAdmin();
  return (
    <div className="adm-card max-w-lg">
      <h1 className="text-xl font-bold">Нет доступа</h1>
      <p className="mt-2 text-sm text-ink-2">
        Этот раздел недоступен для роли «{ROLE_LABEL[admin.role]}». Если доступ нужен для работы, попросите владельца
        магазина изменить роль.
      </p>
      <Link href="/admin" className="btn btn-ghost mt-4">
        На обзор
      </Link>
    </div>
  );
}
