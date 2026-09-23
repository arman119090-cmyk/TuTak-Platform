import { randomUUID } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { audit } from "@/lib/audit";
import { isSameOrigin } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { currentAdmin } from "@/lib/security/session";
import { sniffImage, storage } from "@/lib/storage";

// Admin image upload. Every photo is normalised on the server:
//   - rotated by its EXIF orientation (phone photos come out upright),
//   - metadata stripped (no GPS / camera data leaks),
//   - resized to fit 1800×1800 (never upscaled),
//   - re-encoded to WebP (transparency kept for cut-out PNGs).
// Accepts JPEG, PNG, WebP, AVIF up to 15 MB. SVG is refused (script-capable).
export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const admin = await currentAdmin();
  if (!admin) return new Response("Unauthorized", { status: 401 });
  const limit = await rateLimit("upload", admin.id);
  if (!limit.ok) return new Response("Too many uploads", { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "max 15 MB" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(bytes)) return Response.json({ error: "JPEG, PNG, WebP or AVIF only" }, { status: 415 });

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(bytes, { failOn: "error", limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return Response.json({ error: "image could not be decoded" }, { status: 415 });
  }

  const key = `products/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.webp`;
  const { url } = await storage().put(key, new Uint8Array(out.data), "image/webp");
  await audit({ actor: admin.email, action: "media.upload", entity: "MediaAsset", data: { key, originalBytes: file.size, storedBytes: out.info.size } });
  return Response.json({ url, storageKey: key, width: out.info.width, height: out.info.height });
}
