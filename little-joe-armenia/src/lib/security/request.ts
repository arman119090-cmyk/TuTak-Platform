import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

/**
 * Client IP. Render (and most proxies) append the client address to
 * X-Forwarded-For; the first entry is the original client.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * CSRF defence for route handlers that accept browser POSTs.
 * Server Actions already verify Origin against Host in Next.js; JSON route
 * handlers use this explicit check. Cookies are SameSite=Lax as a second layer.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const allowed = new URL(env().APP_URL);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return o.host === allowed.host || (host !== null && o.host === host);
  } catch {
    return false;
  }
}
