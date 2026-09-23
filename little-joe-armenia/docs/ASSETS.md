# Product images: replacing placeholders

## Current state

- **Every demo product has four generated placeholder images:** PRODUCT, PACKAGING, INSTALLED and DETAIL (`prisma/seed.ts`), all 800×800 with `rights = PLACEHOLDER`.
- **They are served by `GET /media/placeholder/{kind}.svg?c=RRGGBB&i=RRGGBB`** (`src/app/media/placeholder/[name]/route.ts`). Kinds: `product`, `packaging`, `installed`, `detail`, `lifestyle`, `hero`. `c` is the product accent and `i` the ink colour, both validated as 6-digit hex.
- **The figure is deliberately generic.** It is a friendly rounded air-freshener shape and **not** a copy of the manufacturer's character artwork. Brand artwork needs authorisation.
- **Any image not marked `AUTHORIZED` is labelled and left out of search data.** The gallery shows a "placeholder image" caption, and the image is left out of the JSON-LD `image`, the OG image (SVGs are skipped) and the home lifestyle section.

## Rights states (`MediaAsset.rights`)

| Value | Meaning | Storefront |
|---|---|---|
| `PLACEHOLDER` | Generated illustration | Shown with a "placeholder" caption |
| `UNCONFIRMED` | A real photo whose usage rights are not yet documented | Shown with the same caption, not used in structured data or the lifestyle block |
| `AUTHORIZED` | Written permission exists (note it in `rightsNote`) | Shown normally, used in JSON-LD and, for LIFESTYLE/INSTALLED kinds, in the home social block |

**Do not scrape or hot-link copyrighted photos** from the manufacturer or retailers. Use only photos you shot yourself or received with permission.

## Required images per product

| Kind | Content | Priority |
|---|---|---|
| `PRODUCT` | The product alone, on a clean background, facing front | Required. It is the card and first gallery image |
| `PACKAGING` | The retail pack, front | Required |
| `INSTALLED` | Clipped onto a car vent (or in use) | Recommended |
| `DETAIL` | Close-up (clip, texture, label) | Recommended |
| `LIFESTYLE` | Car interior or mood shot | Optional. Also feeds the home "social" block |
| `HERO` | Wide campaign image | Optional |

Recommended format:
- **Square, 1600×1600 px**, sRGB, JPEG/WebP/AVIF (PNG only if transparency is needed).
- 5 MB maximum per upload.
- `next/image` resizes to the configured device sizes (360–1920) and serves AVIF/WebP.

The slots keep their aspect ratio: square in the gallery and cropped to 4:5 on cards (`object-cover`). Replacing images therefore needs **no layout or code change**. Keep the subject centred with some margin so the 4:5 crop does not cut it.

## Workflow

1. **Get the files and the permission.** Record who granted the permission and when (the `rightsNote` field, up to 300 characters).
2. **Store the file** in one of two ways:
   - **Upload:** `POST /api/admin/upload`, multipart field `file` (admin session, same origin). The type is checked by magic bytes (JPEG, PNG, WebP, AVIF), and **SVG is refused**. It goes to the configured storage driver (`STORAGE_DRIVER=local` → `public/uploads`, dev only; `s3` → your bucket) and returns `{ url, storageKey }`. There is no upload button in the admin UI yet (the endpoint exists; the admin is being finished), so for now use it from a script or add images by URL.
   - **By URL:** in `/admin/products/{id}` → Media, add an `https://…` URL or a root-relative `/…` path with its width and height.

   On Render, **do not rely on local uploads**. The disk is ephemeral, so use S3/R2.
3. **Fill in the metadata** in the same Media form:
   - `kind` (see the table above);
   - `rights = AUTHORIZED` (or `UNCONFIRMED` until the paperwork arrives) and `rightsNote`;
   - **alt text in all four languages** (`altHy`, `altRu`, `altIt`, `altEn`, up to 200 characters). Describe the image, e.g. "Little Joe Vanilla clipped to a car air vent". Empty alt text falls back to the product name.
4. **Order the images** with the up/down controls. The first image is the card image.
5. **Delete the placeholder rows** for that product.
6. **Check** the product page on mobile and desktop.

Every media create, update, move, delete and upload is recorded in the audit log.

## Remote image hosts

`next/image` only optimises images from:
- same-origin paths;
- `res.cloudinary.com`;
- the host of `S3_PUBLIC_BASE_URL` (`next.config.ts`).

An `https://` URL on any other host will fail to render through `next/image`. Either upload the file to the bucket, or add the host to `images.remotePatterns` (a code change).
