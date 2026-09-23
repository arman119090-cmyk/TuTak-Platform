import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

// Media storage abstraction. MediaAsset rows store `storageKey` + `url`;
// swapping drivers (local → S3/R2/Cloudinary-compatible S3) or replacing
// placeholder art with authorised photos never touches page code.

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
}

const localDriver: StorageDriver = {
  name: "local",
  // Development only: public/uploads is served by Next. Render's disk is
  // ephemeral, so production must use S3-compatible storage.
  async put(key, body) {
    const file = path.join(process.cwd(), "public", "uploads", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return { url: `/uploads/${key}` };
  },
};

function s3Driver(): StorageDriver {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY || !e.S3_PUBLIC_BASE_URL) {
    throw new Error("S3 storage is not fully configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL)");
  }
  const client = new AwsClient({ accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, region: e.S3_REGION, service: "s3" });
  return {
    name: "s3",
    async put(key, body, contentType) {
      const url = `${e.S3_ENDPOINT!.replace(/\/$/, "")}/${e.S3_BUCKET}/${key}`;
      const res = await client.fetch(url, {
        method: "PUT",
        body,
        headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
      });
      if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
      return { url: `${e.S3_PUBLIC_BASE_URL!.replace(/\/$/, "")}/${key}` };
    },
  };
}

export function storage(): StorageDriver {
  return env().STORAGE_DRIVER === "s3" ? s3Driver() : localDriver;
}

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Checks magic bytes so a renamed file cannot pretend to be an image. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  return null;
}
