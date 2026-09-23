import { db } from "@/lib/db";

// Serves images stored by the "db" storage driver. Keys are random UUIDs,
// so responses are immutable and cached for a year by browsers and CDNs.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const k = key.join("/");
  if (!/^[a-z0-9/_.-]{1,200}$/i.test(k) || k.includes("..")) return new Response("Not found", { status: 404 });
  const blob = await db.mediaBlob.findUnique({ where: { key: k } });
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: {
      "content-type": blob.contentType,
      "content-length": String(blob.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
