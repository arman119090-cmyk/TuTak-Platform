import "../globals.css";
import "./admin.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { currentAdmin } from "@/lib/security/session";
import { navFor } from "@/lib/admin/nav";
import { ROLE_LABEL } from "@/lib/admin/format";
import { AdminNav } from "@/components/admin/nav";
import { MobileMenu } from "@/components/admin/mobile-menu";
import { logoutAction } from "./login/actions";

// Root layout of the back office (separate from the storefront's
// [locale] root layout). NOT a security boundary: every page and every
// Server Action calls requireAdmin() itself.

export const metadata: Metadata = {
  title: { default: "Little Joe · Админка", template: "%s · Админка" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbfbf9" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await currentAdmin();

  if (!admin) {
    return (
      <html lang="ru">
        <body className="adm min-h-dvh">{children}</body>
      </html>
    );
  }

  const items = navFor(admin.role);
  const account = (
    <div className="mt-4 border-t border-line pt-4 text-sm">
      <div className="truncate font-semibold" title={admin.email}>
        {admin.name}
      </div>
      <div className="truncate text-xs text-muted">
        {admin.email} · {ROLE_LABEL[admin.role]}
      </div>
      <form action={logoutAction} className="mt-2">
        <button type="submit" className="btn btn-ghost w-full">
          Выйти
        </button>
      </form>
    </div>
  );

  return (
    <html lang="ru">
      <body className="adm min-h-dvh">
        <a href="#adm-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:text-white">
          К содержимому
        </a>
        <div className="md:flex">
          {/* Desktop sidebar */}
          <aside className="hidden md:block md:w-60 md:shrink-0 md:border-r md:border-line md:bg-card">
            <div className="sticky top-0 flex max-h-dvh flex-col overflow-y-auto p-4">
              <div className="mb-5 px-3 leading-none"><span className="block font-[family-name:var(--font-logo)] text-[1.6rem]">Little Joe</span><span className="mt-1 block text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">Админ-панель</span></div>
              <AdminNav items={items} />
              {account}
            </div>
          </aside>
          {/* Mobile: collapsible menu */}
          <MobileMenu>
            <AdminNav items={items} />
            {account}
          </MobileMenu>
          <main id="adm-main" className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
