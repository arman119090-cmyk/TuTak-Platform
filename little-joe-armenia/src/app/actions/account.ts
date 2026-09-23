"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { paths } from "@/lib/paths";
import { normalizeArmenianPhone, REGION_CODES } from "@/lib/armenia";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { currentCustomer, currentGuestId, endCustomerSession, startCustomerSession } from "@/lib/security/session";
import { channelAvailable, requestCode, verifyCode, type Channel } from "@/lib/domain/customer-auth";
import { addItem, mergeGuestIntoCustomer } from "@/lib/domain/cart";

function target(channel: Channel, raw: string): string | null {
  if (channel === "EMAIL") {
    const e = z.email().max(120).safeParse(raw.trim().toLowerCase());
    return e.success ? e.data : null;
  }
  return normalizeArmenianPhone(raw);
}

export type AuthState =
  | { step: "request"; error?: "invalid" | "rateLimited" | "unavailable" | "error" }
  | { step: "verify"; channel: Channel; target: string; screenCode: string | null; error?: "codeInvalid" | "rateLimited" };

export async function requestCodeAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const channel: Channel = form.get("channel") === "PHONE" ? "PHONE" : "EMAIL";
  if (!channelAvailable(channel)) return { step: "request", error: "unavailable" };
  const t = target(channel, String(form.get("target") ?? ""));
  if (!t) return { step: "request", error: "invalid" };
  const ip = await clientIp();
  const [byIp, byTarget] = await Promise.all([rateLimit("authRequest", ip), rateLimit("authRequest", `t:${t}`)]);
  if (!byIp.ok || !byTarget.ok) return { step: "request", error: "rateLimited" };
  try {
    const { screenCode } = await requestCode(channel, t);
    return { step: "verify", channel, target: t, screenCode };
  } catch {
    return { step: "request", error: "error" };
  }
}

export async function verifyCodeAction(prev: AuthState, form: FormData): Promise<AuthState> {
  if (prev.step !== "verify") return { step: "request" };
  const locale = String(form.get("locale"));
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const limit = await rateLimit("authVerify", `${await clientIp()}:${prev.target}`);
  if (!limit.ok) return { ...prev, error: "rateLimited" };
  const customerId = code.length === 6 ? await verifyCode(prev.channel, prev.target, code) : null;
  if (!customerId) return { ...prev, error: "codeInvalid" };
  const guestId = await currentGuestId();
  await startCustomerSession(customerId);
  if (guestId) await mergeGuestIntoCustomer(guestId, customerId);
  redirect(paths.account(isLocale(locale) ? locale : "hy"));
}

export async function signOutAction(form: FormData) {
  const locale = String(form.get("locale"));
  await endCustomerSession();
  redirect(paths.home(isLocale(locale) ? locale : "hy"));
}

const addressSchema = z.object({
  region: z.enum(REGION_CODES),
  city: z.string().trim().min(1).max(80),
  street: z.string().trim().min(1).max(120),
  building: z.string().trim().min(1).max(20),
  apartment: z.string().trim().max(20).optional(),
  entrance: z.string().trim().max(10).optional(),
  floor: z.string().trim().max(10).optional(),
  comment: z.string().trim().max(500).optional(),
});

export async function addAddressAction(_prev: { ok: boolean }, form: FormData): Promise<{ ok: boolean }> {
  const customer = await currentCustomer();
  if (!customer) return { ok: false };
  const parsed = addressSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false };
  const count = await db.address.count({ where: { customerId: customer.id } });
  if (count >= 10) return { ok: false };
  await db.address.create({ data: { ...parsed.data, customerId: customer.id, isDefault: count === 0 } });
  return { ok: true };
}

export async function deleteAddressAction(form: FormData) {
  const customer = await currentCustomer();
  if (!customer) return;
  const id = z.string().max(40).parse(form.get("id"));
  await db.address.deleteMany({ where: { id, customerId: customer.id } });
  const locale = String(form.get("locale"));
  redirect(paths.account(isLocale(locale) ? (locale as Locale) : "hy"));
}

/** Adds every still-available item of a past order back to the cart. */
export async function buyAgainAction(form: FormData) {
  const customer = await currentCustomer();
  const locale = String(form.get("locale"));
  const l: Locale = isLocale(locale) ? locale : "hy";
  if (!customer) redirect(paths.signIn(l));
  const orderId = z.string().max(40).parse(form.get("orderId"));
  const order = await db.order.findFirst({ where: { id: orderId, customerId: customer.id }, include: { items: true } });
  if (order) {
    for (const i of order.items) await addItem({ customerId: customer.id, guestId: null }, i.variantId, i.quantity);
  }
  redirect(paths.cart(l));
}
