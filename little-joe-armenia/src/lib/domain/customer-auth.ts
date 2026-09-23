import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomCode, safeEqual } from "@/lib/security/crypto";

// Passwordless sign-in: a 6-digit one-time code sent by email (Resend) or,
// once an SMS gateway is contracted, by SMS. Codes are stored hashed, expire
// after 10 minutes, allow 5 attempts, and are single use.

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export type Channel = "EMAIL" | "PHONE";

export function channelAvailable(channel: Channel): boolean {
  const mode = env().AUTH_CODE_DELIVERY;
  if (mode === "screen") return true;
  if (channel === "EMAIL") return mode === "resend" || env().NODE_ENV !== "production";
  // No SMS gateway yet: phone codes only in development/demo.
  return env().NODE_ENV !== "production";
}

async function deliver(channel: Channel, target: string, code: string) {
  const e = env();
  if (e.AUTH_CODE_DELIVERY === "resend" && channel === "EMAIL") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [target],
        subject: `${e.STORE_NAME}: ${code}`,
        text: `${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`Email delivery failed: ${res.status}`);
    return;
  }
  if (e.NODE_ENV !== "production" || e.AUTH_CODE_DELIVERY === "screen") {
    console.info(`[auth] one-time code for ${channel} ${target}: ${code}`);
  }
}

/** Creates a challenge and delivers the code. Returns the code only in screen (demo) mode. */
export async function requestCode(channel: Channel, target: string): Promise<{ screenCode: string | null }> {
  const code = randomCode(6);
  await db.authChallenge.create({
    data: { channel, target, codeHash: hashToken(`${target}:${code}`), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  await deliver(channel, target, code);
  return { screenCode: env().AUTH_CODE_DELIVERY === "screen" ? code : null };
}

/** Verifies a code and returns the customer id (creating the customer on first sign-in). */
export async function verifyCode(channel: Channel, target: string, code: string): Promise<string | null> {
  const challenge = await db.authChallenge.findFirst({
    where: { channel, target, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.attempts >= MAX_ATTEMPTS) return null;
  // Count the attempt before comparing, atomically.
  const bumped = await db.authChallenge.updateMany({
    where: { id: challenge.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (bumped.count !== 1) return null;
  if (!safeEqual(hashToken(`${target}:${code}`), challenge.codeHash)) return null;
  const consumed = await db.authChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) return null;

  const where = channel === "EMAIL" ? { email: target } : { phone: target };
  const customer = await db.customer.upsert({ where, create: where, update: {} });
  return customer.id;
}
