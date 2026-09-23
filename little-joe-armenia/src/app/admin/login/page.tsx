import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/security/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Public page: the only admin page without requireAdmin().
  if (await currentAdmin()) redirect("/admin");
  const { next } = await searchParams;
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="adm-card w-full max-w-sm">
        <h1 className="text-xl font-bold">Вход в админку</h1>
        <p className="mt-1 text-sm text-muted">Little Joe Armenia · служебный раздел</p>
        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </div>
  );
}
