import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

/**
 * Client IP for rate limiting. The client can send any X-Forwarded-For it
 * likes; only the LAST entry is appended by our own edge proxy (Render),
 * so that is the one we trust. Taking the first entry would let an
 * attacker rotate fake IPs and bypass every per-IP limit.
 */
export function ipFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return h.get("x-real-ip") ?? "unknown";
}

export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers());
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
