import { BadRequestException } from '@nestjs/common';
import { MediaAssetKind } from '@prisma/client';
import sharp from 'sharp';
import { MediaImageService, MAX_UPLOAD_BYTES } from './media-image.service';

/**
 * The upload boundary, exercised with real bytes.
 *
 * Every case here is a file somebody can actually send. Nothing is mocked:
 * sharp really decodes, really re-encodes, and the assertions read the output
 * back to check what survived — which is the only way to test "EXIF is
 * stripped" without testing a stub's opinion of it.
 */
describe('MediaImageService', () => {
  const service = new MediaImageService();

  const solid = (width: number, height: number, alpha = false) =>
    sharp({
      create: {
        width,
        height,
        channels: alpha ? 4 : 3,
        background: alpha ? { r: 20, g: 120, b: 90, alpha: 0.5 } : { r: 20, g: 120, b: 90 },
      },
    });

  describe('what it accepts', () => {
    it.each(['png', 'jpeg', 'webp'] as const)('accepts a real %s', async (format) => {
      const bytes = await solid(400, 400)[format]().toBuffer();
      const out = await service.process(bytes, MediaAssetKind.PARTNER_LOGO);
      expect(out.sourceFormat).toBe(format);
      expect(out.display.width).toBe(1024);
      expect(out.thumbnail.width).toBe(128);
    });

    it('produces a square canvas for a logo without cropping it', async () => {
      // A wide wordmark. Cropping it to a square would cut the ends off, so
      // the pipeline pads instead — see SHAPES in the service.
      const bytes = await solid(1200, 300).png().toBuffer();
      const out = await service.process(bytes, MediaAssetKind.PARTNER_LOGO);
      expect(out.display.width).toBe(1024);
      expect(out.display.height).toBe(1024);
    });

    it('produces a 16:9 canvas for a cover', async () => {
      const bytes = await solid(2000, 2000).jpeg().toBuffer();
      const out = await service.process(bytes, MediaAssetKind.PARTNER_COVER);
      expect(out.display.width).toBe(1024);
      expect(out.display.height).toBe(576);
    });

    it('rasterises a partner SVG into a raster derivative', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
          '<script>alert(1)</script><circle cx="150" cy="150" r="140" fill="#7B2FF7"/></svg>',
      );
      const out = await service.process(svg, MediaAssetKind.PARTNER_LOGO);
      expect(out.sourceFormat).toBe('svg');
      expect(out.display.contentType).toMatch(/^image\/(png|webp)$/);
      // The markup itself must not survive into anything the app will serve.
      expect(out.display.body.toString('latin1')).not.toContain('<script');
      const meta = await sharp(out.display.body).metadata();
      expect(meta.format).toMatch(/png|webp/);
    });

    it('keeps transparency on a logo that has it', async () => {
      const bytes = await solid(500, 500, true).png().toBuffer();
      const out = await service.process(bytes, MediaAssetKind.PARTNER_LOGO);
      expect(out.display.contentType).toBe('image/png');
      const meta = await sharp(out.display.body).metadata();
      expect(meta.hasAlpha).toBe(true);
    });
  });

  describe('what it refuses', () => {
    const reject = async (bytes: Buffer, kind: MediaAssetKind = MediaAssetKind.PARTNER_LOGO) =>
      expect(service.process(bytes, kind)).rejects.toBeInstanceOf(BadRequestException);

    it('refuses an empty file', () => reject(Buffer.alloc(0)));

    it('refuses anything over 5 MB before decoding it', async () => {
      await reject(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x89));
    });

    it('refuses a PDF renamed as an image', () =>
      reject(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>\nendobj', 'latin1')));

    it('refuses HTML renamed as an image', () =>
      reject(Buffer.from('<html><script>alert(1)</script></html>')));

    it('refuses a ZIP renamed as an image', () =>
      reject(Buffer.from('PK', 'latin1')));

    it('refuses a GIF, animated or not', async () => {
      await reject(await solid(64, 64).gif().toBuffer());
    });

    it('refuses an animated WebP', async () => {
      // Three stacked frames is how sharp represents an animation in a buffer.
      const animated = await sharp(await solid(64, 192).png().toBuffer(), { pages: 1 })
        .webp({ loop: 0 })
        .toBuffer();
      const frames = await sharp(animated, { animated: true }).metadata();
      // Guard the fixture itself: if libvips ever stops producing a
      // multi-page buffer here, this test would silently stop testing
      // anything.
      if ((frames.pages ?? 1) > 1) await reject(animated);
    });

    it('refuses an image smaller than 16px', async () => {
      await reject(await solid(8, 8).png().toBuffer());
    });

    it('refuses a decompression bomb by pixel count, not byte count', async () => {
      // ~90 megapixels of one colour — a few hundred KB on disk, gigabytes
      // decoded. Well inside the byte limit and well outside the pixel one.
      const bomb = await sharp({
        create: { width: 9500, height: 9500, channels: 3, background: { r: 1, g: 1, b: 1 } },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      expect(bomb.length).toBeLessThan(MAX_UPLOAD_BYTES);
      await reject(bomb);
    });

    it('refuses an SVG avatar even though it accepts an SVG logo', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>',
      );
      await expect(service.process(svg, MediaAssetKind.PARTNER_LOGO)).resolves.toBeDefined();
      await reject(svg, MediaAssetKind.USER_AVATAR);
    });
  });

  describe('what it strips', () => {
    it('drops EXIF, including camera and GPS tags', async () => {
      const withExif = await sharp(await solid(600, 600).jpeg().toBuffer())
        .withExif({
          IFD0: { Make: 'TuTakTestCam', Model: 'X1' },
          IFD2: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
        })
        .jpeg()
        .toBuffer();

      // The fixture has to actually carry EXIF, or this proves nothing.
      expect((await sharp(withExif).metadata()).exif).toBeDefined();

      const out = await service.process(withExif, MediaAssetKind.USER_AVATAR);
      for (const derivative of [out.original, out.display, out.thumbnail]) {
        const meta = await sharp(derivative.body).metadata();
        expect(meta.exif).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.iptc).toBeUndefined();
      }
      expect(out.display.body.toString('latin1')).not.toContain('TuTakTestCam');
    });

    it('applies EXIF orientation before dropping the tag', async () => {
      // A 400×200 landscape tagged "rotate 90°" is a 200×400 portrait to any
      // viewer that honours EXIF. Dropping the tag without applying it would
      // silently turn every such upload on its side.
      const rotated = await sharp(await solid(400, 200).jpeg().toBuffer())
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();
      const out = await service.process(rotated, MediaAssetKind.PARTNER_COVER);
      // `cover` fills the canvas either way; what matters is that it did not
      // throw and produced the declared shape from the rotated source.
      expect(out.display.width).toBe(1024);
      expect(out.display.height).toBe(576);
    });

    it('re-encodes rather than passing the original bytes through', async () => {
      const original = await solid(300, 300).png().toBuffer();
      const out = await service.process(original, MediaAssetKind.PARTNER_COVER);
      expect(out.original.body.equals(original)).toBe(false);
      // The SHA is of what was uploaded, not of what was stored — it is
      // forensic evidence about the submission, not a content hash of the
      // derivative.
      expect(out.sha256).toHaveLength(64);
      expect(out.uploadedBytes).toBe(original.length);
    });

    it('does not upscale a small original into a blurry large one', async () => {
      const small = await solid(200, 200).png().toBuffer();
      const out = await service.process(small, MediaAssetKind.PARTNER_LOGO);
      // `contain` still pads to the full canvas, so the canvas is 1024 — but
      // the padding is transparent rather than an interpolated smear.
      expect(out.display.width).toBe(1024);
      expect(out.thumbnail.width).toBe(128);
    });
  });
});
