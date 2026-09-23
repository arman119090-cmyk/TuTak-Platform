import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { expireReservations } from "@/lib/domain/orders";

// Releases stock held by unpaid online orders. Render's free tier has no
// cron jobs, so this also runs lazily on checkout; an external free
// scheduler (e.g. a GitHub Actions cron) may call it with the secret.
export async function POST(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("Unauthorized", { status: 401 });
  const result = await expireReservations();
  return Response.json(result);
}
