import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomToken } from "@/lib/security/crypto";

// Three independent cookie-backed identities, all opaque random tokens whose
// keyed hash is stored server-side:
//   guest    — cart and favourites without an account (180 days)
//   customer — signed-in shopper via email link / phone code (30 days)
//   admin    — back office (12 hours, SameSite=Strict)
// In production the cookies use the __Host- prefix (Secure, Path=/, no Domain).

const secure = () => env().APP_URL.startsWith("https://");
export const cookieName = (base: string) => (secure() ? `__Host-${base}` : base);

const GUEST = "lj_guest";
const CUSTOMER = "lj_session";
const ADMIN = "lj_admin";

const DAY = 24 * 60 * 60;

async function setCookie(base: string, value: string, maxAge: number, sameSite: "lax" | "strict") {
  const jar = await cookies();
  jar.set(cookieName(base), value, {
    httpOnly: true,
    secure: secure(),
    sameSite,
    path: "/",
    maxAge,
  });
}

async function readCookie(base: string): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(cookieName(base))?.value;
}

async function clearCookie(base: string) {
  const jar = await cookies();
  jar.delete(cookieName(base));
}

// ── Guest ──

export async function currentGuestId(): Promise<string | null> {
  const token = await readCookie(GUEST);
  if (!token || token.length > 100) return null;
  const guest = await db.guest.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } });
  return guest?.id ?? null;
}

/** Returns the guest id, creating the guest + cookie when absent. Server Actions / Route Handlers only. */
export async function ensureGuestId(): Promise<string> {
  const existing = await currentGuestId();
  if (existing) return existing;
  const token = randomToken();
  const guest = await db.guest.create({ data: { tokenHash: hashToken(token) } });
  await setCookie(GUEST, token, 180 * DAY, "lax");
  return guest.id;
}

// ── Customer ──

export async function currentCustomer() {
  const token = await readCookie(CUSTOMER);
  if (!token || token.length > 100) return null;
  const session = await db.customerSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { customer: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.customer;
}

export async function startCustomerSession(customerId: string) {
  const token = randomToken();
  await db.customerSession.create({
    data: { customerId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * DAY * 1000) },
  });
  await setCookie(CUSTOMER, token, 30 * DAY, "lax");
}

export async function endCustomerSession() {
  const token = await readCookie(CUSTOMER);
  if (token) await db.customerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  await clearCookie(CUSTOMER);
}

// ── Admin ──

export async function currentAdmin() {
  const token = await readCookie(ADMIN);
  if (!token || token.length > 100) return null;
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { admin: true },
  });
  if (!session || session.expiresAt < new Date() || !session.admin.isActive) return null;
  return session.admin;
}

export async function startAdminSession(adminId: string) {
  const token = randomToken();
  await db.adminSession.create({
    data: { adminId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 12 * 3600 * 1000) },
  });
  await setCookie(ADMIN, token, 12 * 3600, "strict");
}

export async function endAdminSession() {
  const token = await readCookie(ADMIN);
  if (token) await db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  await clearCookie(ADMIN);
}

/** Owner of cart/favourites for the current request: customer wins over guest. */
export async function shopper(): Promise<{ customerId: string | null; guestId: string | null }> {
  const customer = await currentCustomer();
  if (customer) return { customerId: customer.id, guestId: null };
  return { customerId: null, guestId: await currentGuestId() };
}
