import { handleCallback } from "@/lib/payments/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { ipFromHeaders } from "@/lib/security/request";

// Server-to-server payment notifications. No cookies, no CSRF token: the
// request is authenticated by the provider's signature (verified in the
// adapter) and deduplicated by (adapter, eventId).

export async function POST(request: Request, { params }: { params: Promise<{ adapter: string }> }) {
  const { adapter } = await params;
  if (!/^[a-z]{2,20}$/.test(adapter)) return new Response("Not found", { status: 404 });
  const ip = ipFromHeaders(request.headers);
  const limit = await rateLimit("webhook", `${adapter}:${ip}`);
  if (!limit.ok) return new Response("Too many requests", { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } });
  const { response, outcome } = await handleCallback(adapter, request);
  console.info(`[payments] ${adapter} callback → ${outcome}`);
  return response;
}
