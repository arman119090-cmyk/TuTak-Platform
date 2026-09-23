import "server-only";
import { redirect } from "next/navigation";
import type { AdminRole } from "@/generated/prisma/client";
import { currentAdmin } from "@/lib/security/session";

// Back-office authorisation. EVERY admin page and EVERY admin Server Action
// calls requireAdmin() first: Server Actions are public POST endpoints, the
// layout is not a security boundary.
//
// Roles:
//   OWNER   — everything, incl. admin users, settings, payments, audit log
//   MANAGER — orders, customers, products (incl. prices/stock), promotions, reviews
//   CONTENT — product content/translations, collections, CMS, reviews

export const ALL_ROLES: AdminRole[] = ["OWNER", "MANAGER", "CONTENT"];

export const AREA_ROLES = {
  dashboard: ALL_ROLES,
  orders: ["OWNER", "MANAGER"],
  customers: ["OWNER", "MANAGER"],
  products: ALL_ROLES,
  // Status, flags, variants/prices and stock of a product.
  productCommerce: ["OWNER", "MANAGER"],
  inventory: ["OWNER", "MANAGER"],
  promotions: ["OWNER", "MANAGER"],
  reviews: ALL_ROLES,
  collections: ["OWNER", "CONTENT"],
  cms: ["OWNER", "CONTENT"],
  imports: ALL_ROLES,
  translations: ALL_ROLES,
  settings: ["OWNER"],
  audit: ["OWNER"],
  users: ["OWNER"],
} satisfies Record<string, AdminRole[]>;

export type Area = keyof typeof AREA_ROLES;

export type AdminUserSession = NonNullable<Awaited<ReturnType<typeof currentAdmin>>>;

export function canAccess(role: AdminRole, area: Area): boolean {
  return (AREA_ROLES[area] as AdminRole[]).includes(role);
}

/**
 * Returns the signed-in admin or redirects to /admin/login. When the role
 * is not allowed, redirects to /admin/denied (redirect() throws, so the
 * caller never continues — works in pages and in Server Actions alike).
 * Must be called OUTSIDE try/catch blocks.
 */
export async function requireAdmin(allowed: Area | AdminRole[] = ALL_ROLES): Promise<AdminUserSession> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  const roles = typeof allowed === "string" ? AREA_ROLES[allowed] : allowed;
  if (!(roles as AdminRole[]).includes(admin.role)) redirect("/admin/denied");
  return admin;
}
