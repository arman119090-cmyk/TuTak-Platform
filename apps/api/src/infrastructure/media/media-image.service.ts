import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MediaAssetKind } from '@prisma/client';
import sharp from 'sharp';
import type { FitEnum, Metadata } from 'sharp';

/** Spec §3.1: maximum original upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Ceiling on decoded pixels, independent of the byte ceiling.
 *
 * A 5 MB file is not a 5 MB image: PNG's own compression will happily encode a
 * 30 000 × 30 000 canvas of one colour into a few kilobytes, and decoding it
 * would allocate ~3.6 GB. That is a one-request denial of service against a
 * process holding database connections. 50 megapixels is roughly an 8K × 6K
 * photograph — far past anything a logo or an avatar needs, and small enough
 * that the worst case is a couple of hundred megabytes rather than the heap.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Spec §3.1. Sniffed from the bytes; the declared content type is ignored. */
const ACCEPTED_RASTER_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp']);

export interface ProcessedDerivative {
  body: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface ProcessedImage {
  /** Re-encoded, metadata-stripped full-size copy. Never the raw upload. */
  original: ProcessedDerivative;
  /** 1024px derivative — spec §3.1. */
  display: ProcessedDerivative;
  /** 128px derivative — spec §3.1. */
  thumbnail: ProcessedDerivative;
  /** SHA-256 of the bytes as uploaded, for dedup and forensics. */
  sha256: string;
  /** Byte size of the upload as received. */
  uploadedBytes: number;
  /** The format the server actually produced. Not the caller's claim. */
  sourceFormat: string;
}

/**
 * Turns an untrusted upload into a set of safe derivatives, or refuses it.
 *
 * Everything in spec §3.1 happens here and nowhere else:
 *
 *  - the format is decided by **inspecting the bytes** (`sharp.metadata()`
 *    parses the container), never by the filename or the declared
 *    `Content-Type`. A `.png` that is really a PDF, an HTML file, or a ZIP
 *    fails to parse and is rejected; a `.png` that is really a JPEG is
 *    accepted as a JPEG, because what it *is* is the only thing that matters;
 *  - animated formats are refused (`metadata.pages > 1`) — an animated WebP
 *    or APNG rendered as a partner's identity is not a still logo, and the
 *    frames are an easy place to hide a second image;
 *  - EXIF, ICC, XMP and IPTC are dropped. sharp strips all of it unless
 *    `withMetadata()` is called, which nothing here calls — so a customer
 *    uploading a phone photo does not also upload the GPS coordinates of
 *    where they took it;
 *  - SVG is rasterised on the server into a PNG/WebP derivative and the
 *    original markup is never stored or served. Spec §3.1 permits a partner
 *    to *supply* SVG and forbids the public app from ever rendering
 *    untrusted SVG — a format that can carry `<script>`, external
 *    references and XML entity expansion has no business reaching a browser
 *    from user input. Accepted for partner brand media only, never for a
 *    customer avatar, because there is no reason for a person's photograph
 *    to be a vector document.
 *
 * The output is always re-encoded. Passing the original bytes through, even
 * after validating them, would preserve every trailing byte, every ancillary
 * chunk and every polyglot trick the parser tolerated; re-encoding from the
 * decoded pixels means what is stored is a picture and nothing else.
 */
@Injectable()
export class MediaImageService {
  private readonly logger = new Logger(MediaImageService.name);

  async process(upload: Buffer, kind: MediaAssetKind): Promise<ProcessedImage> {
    if (upload.length === 0) {
      throw new BadRequestException('The uploaded file is empty');
    }
    if (upload.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `The image is ${(upload.length / 1024 / 1024).toFixed(1)} MB. The maximum is 5 MB.`,
      );
    }

    const metadata = await this.readMetadata(upload);
    const format = metadata.format ?? 'unknown';

    if (format === 'svg') {
      if (kind === MediaAssetKind.USER_AVATAR) {
        throw new BadRequestException('An avatar must be a JPEG, PNG or WebP image, not SVG');
      }
    } else if (!ACCEPTED_RASTER_FORMATS.has(format)) {
      throw new BadRequestException(
        `Unsupported image format "${format}". Accepted formats are JPEG, PNG and WebP.`,
      );
    }

    if ((metadata.pages ?? 1) > 1) {
      throw new BadRequestException('Animated images are not accepted — please upload a still image');
    }

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 16 || height < 16) {
      throw new BadRequestException('The image is too small — it must be at least 16×16 pixels');
    }
    if (width * height > MAX_INPUT_PIXELS) {
      throw new BadRequestException('The image has too many pixels — the maximum is 50 megapixels');
    }

    const shape = SHAPES[kind];
    // Alpha is worth preserving for a brand mark sitting on the app's own
    // surface; spec §3.1 calls this out explicitly. A photograph does not
    // need it, and WebP is roughly a third the size for the same quality.
    const wantsPng = kind === MediaAssetKind.PARTNER_LOGO && (metadata.hasAlpha === true || format === 'svg');

    const original = await this.render(upload, shape.original, shape.fit, wantsPng);
    const display = await this.render(upload, shape.display, shape.fit, wantsPng);
    const thumbnail = await this.render(upload, shape.thumbnail, shape.fit, wantsPng);

    return {
      original,
      display,
      thumbnail,
      sha256: createHash('sha256').update(upload).digest('hex'),
      uploadedBytes: upload.length,
      sourceFormat: format,
    };
  }

  private async readMetadata(upload: Buffer): Promise<Metadata> {
    try {
      return await sharp(upload, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      // Deliberately not echoing libvips' parser error back to the caller: it
      // names internal loaders and offsets, which is a fingerprinting gift and
      // means nothing to the person holding a photograph.
      throw new BadRequestException(
        'That file could not be read as an image. Accepted formats are JPEG, PNG and WebP.',
      );
    }
  }

  private async render(
    upload: Buffer,
    size: { width: number; height: number },
    fit: keyof FitEnum,
    asPng: boolean,
  ): Promise<ProcessedDerivative> {
    const pipeline = sharp(upload, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate() // apply the EXIF orientation before the tag is dropped
      .resize({
        width: size.width,
        height: size.height,
        fit,
        // Never upscale a small original into a blurry large one; `contain`
        // still pads to the requested canvas so the shape stays predictable.
        withoutEnlargement: fit !== 'cover',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

    const body = asPng
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.webp({ quality: 88 }).toBuffer();

    const out = await sharp(body).metadata();
    return {
      body,
      contentType: asPng ? 'image/png' : 'image/webp',
      width: out.width ?? size.width,
      height: out.height ?? size.height,
    };
  }
}

/**
 * The canvas each kind is rendered onto.
 *
 * A brand mark is `contain`-ed, never cropped: a wordmark whose left third has
 * been cut off to fill a square is worse than one with transparent margins, and
 * the platform does not get to decide which third of somebody's logo matters. A
 * face is `cover`-ed, because a portrait letterboxed inside a circle looks
 * broken and a centre crop is what every avatar UI on earth does.
 *
 * Logos and avatars come out square so the client can render them in a square
 * or a circle with no cropping decision of its own; a cover is 16:9, which is
 * the shape of the card it sits behind.
 */
const SHAPES: Record<
  MediaAssetKind,
  {
    original: { width: number; height: number };
    display: { width: number; height: number };
    thumbnail: { width: number; height: number };
    fit: keyof FitEnum;
  }
> = {
  USER_AVATAR: {
    original: { width: 2048, height: 2048 },
    display: { width: 1024, height: 1024 },
    thumbnail: { width: 128, height: 128 },
    fit: 'cover',
  },
  PARTNER_LOGO: {
    original: { width: 2048, height: 2048 },
    display: { width: 1024, height: 1024 },
    thumbnail: { width: 128, height: 128 },
    fit: 'contain',
  },
  PARTNER_COVER: {
    original: { width: 2048, height: 1152 },
    display: { width: 1024, height: 576 },
    thumbnail: { width: 128, height: 72 },
    fit: 'cover',
  },
};
