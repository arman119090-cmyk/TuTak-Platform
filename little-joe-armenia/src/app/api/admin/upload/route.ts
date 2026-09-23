import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { isSameOrigin } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { currentAdmin } from "@/lib/security/session";
import { ALLOWED_IMAGE_TYPES, sniffImage, storage } from "@/lib/storage";

// Admin image upload → storage driver. Returns the public URL to store on a
// MediaAsset. SVG is refused (script-capable). Max 5 MB.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return new Response("Unauthorized", { status: 401 });
  const limit = await rateLimit("upload", admin.id);
  if (!limit.ok) return new Response("Too many uploads", { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return Response.json({ error: "max 5 MB" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES[type]) return Response.json({ error: "JPEG, PNG, WebP or AVIF only" }, { status: 415 });
  const key = `products/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ALLOWED_IMAGE_TYPES[type]}`;
  const { url } = await storage().put(key, bytes, type);
  await audit({ actor: admin.email, action: "media.upload", entity: "MediaAsset", data: { key, size: file.size } });
  return Response.json({ url, storageKey: key });
}
