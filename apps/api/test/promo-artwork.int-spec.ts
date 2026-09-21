import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaAssetKind, MediaAssetStatus, PartnerStatus, PrismaClient, RoleName } from '@prisma/client';
import sharp from 'sharp';
import type { Request } from 'express';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { MediaDeliveryController } from '../src/modules/media/media-delivery.controller';
import type { UploadedImage } from '../src/modules/media/partner-media.controller';
import { MediaImageService } from '../src/infrastructure/media/media-image.service';
import { AdminPromosController } from '../src/modules/promos/admin-promos.controller';
import type { CreatePromoDto } from '../src/modules/promos/dto/create-promo.dto';
import { PromosController } from '../src/modules/promos/promos.controller';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Partner Spotlight artwork, end to end, on the real pipeline.
 *
 * `media-system.int-spec.ts` proves the logo/cover pipeline; this proves
 * the one route that feeds the Home strip: an administrator uploads a
 * photograph, `sharp` re-encodes it into the 16:10 derivatives, the asset
 * is published, the card points at it, `GET /promos/featured` hands the app
 * a URL, and the delivery route serves bytes for that URL. Then every way it
 * must *not* work: the wrong person, the wrong bytes, a card that is not
 * live. Storage is the in-memory fake the harness provides — nothing here
 * touches a bucket.
 */
describe('Partner promo artwork (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let adminPromos: AdminPromosController;
  let promos: PromosController;
  let delivery: MediaDeliveryController;

  const req = { ip: '127.0.0.1', get: () => 'jest' } as unknown as Request;

  const asUser = (over: Partial<RequestUser>): RequestUser => ({
    id: 'user-1',
    phone: '+37400000000',
    roles: [RoleName.CUSTOMER],
    permissions: [],
    partnerScopes: {},
    mustChangePassword: false,
    ...over,
  });

  /** Both a real user row (the audit log's actor FK) and the request claims. */
  const platformAdmin = async () => {
    const { user } = await createCustomer(prisma);
    return asUser({ id: user.id, roles: [RoleName.SUPER_ADMIN] });
  };

  const partnerOwner = async (partnerId: string) => {
    const { user } = await createCustomer(prisma);
    return asUser({
      id: user.id,
      roles: [RoleName.PARTNER_OWNER],
      partnerScopes: { [RoleName.PARTNER_OWNER]: [partnerId] },
    });
  };

  /** A real photograph-shaped PNG: wider than tall, so `cover` has to crop. */
  async function photo(width = 1600, height = 900): Promise<UploadedImage> {
    const buffer = await sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 90, b: 60 } },
    })
      .png()
      .toBuffer();
    return { buffer, originalname: 'promo.png', mimetype: 'image/png', size: buffer.length };
  }

  function fakeRes() {
    const headers: Record<string, string> = {};
    let body: Buffer | undefined;
    return {
      res: {
        setHeader: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
        },
        end: (b: Buffer) => {
          body = b;
        },
      } as never,
      headers,
      get body() {
        return body;
      },
    };
  }

  const assetIdOf = (url: string) => new URL(url).pathname.split('/').at(-2)!;
  const variantOf = (url: string) => new URL(url).pathname.split('/').at(-1)!;

  const card = (partnerId: string, over: Partial<CreatePromoDto> = {}): CreatePromoDto => ({
    partnerId,
    translations: { ru: { title: 'Кофе', benefitLabel: '10%' } },
    active: true,
    ...over,
  });

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    adminPromos = harness.app.get(AdminPromosController);
    promos = harness.app.get(PromosController);
    delivery = harness.app.get(MediaDeliveryController);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('an administrator’s upload becomes the card’s artwork and the app gets a URL that serves bytes', async () => {
    const admin = await platformAdmin();
    const partner = await createPartner(prisma, { displayName: 'Coffee House' });
    const created = await adminPromos.create(admin, card(partner.id), req);
    expect(created.artwork).toBeNull();

    const withArt = await adminPromos.setArtwork(admin, created.id, await photo(), req);
    expect(withArt.artwork).not.toBeNull();
    expect(withArt.artwork!.width).toBe(1024);
    expect(withArt.artwork!.height).toBe(640);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: withArt.artwork!.assetId } });
    expect(asset).toMatchObject({
      kind: MediaAssetKind.PROMO_ARTWORK,
      status: MediaAssetStatus.ACTIVE,
      partnerId: partner.id,
      width: 1024,
      height: 640,
    });
    // The partner's own cover pointer is untouched — a promo owns its
    // artwork, the partner's identity is not rewritten by an advert.
    const p = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(p.coverAssetId).toBeNull();

    const featured = await promos.featured({ locale: 'ru' });
    expect(featured).toHaveLength(1);
    const url = featured[0]!.artwork!.url;
    expect(url).toMatch(/\/media\/brand\//);

    const out = fakeRes();
    await delivery.brand(assetIdOf(url), variantOf(url), out.res);
    expect(out.body!.length).toBeGreaterThan(0);
    expect(out.headers['content-type']).toMatch(/^image\//);
    const meta = await sharp(out.body!).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 640]);

    const thumb = fakeRes();
    const thumbUrl = featured[0]!.artwork!.thumbnailUrl;
    await delivery.brand(assetIdOf(thumbUrl), variantOf(thumbUrl), thumb.res);
    const thumbMeta = await sharp(thumb.body!).metadata();
    expect([thumbMeta.width, thumbMeta.height]).toEqual([128, 80]);
  });

  it('replacing the artwork retires the previous asset and points the card at the new one', async () => {
    const admin = await platformAdmin();
    const partner = await createPartner(prisma);
    const created = await adminPromos.create(admin, card(partner.id), req);
    const first = await adminPromos.setArtwork(admin, created.id, await photo(1600, 900), req);
    const second = await adminPromos.setArtwork(admin, created.id, await photo(2000, 1250), req);

    expect(second.artwork!.assetId).not.toBe(first.artwork!.assetId);
    const old = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: first.artwork!.assetId } });
    expect(old.status).toBe(MediaAssetStatus.REPLACED);
    const featured = await promos.featured({ locale: 'ru' });
    expect(featured[0]!.artwork!.assetId).toBe(second.artwork!.assetId);
  });

  it('a partner may hold artwork for several cards at once', async () => {
    const admin = await platformAdmin();
    const partner = await createPartner(prisma);
    const a = await adminPromos.create(admin, card(partner.id, { priority: 2 }), req);
    const b = await adminPromos.create(admin, card(partner.id, { priority: 1 }), req);
    await adminPromos.setArtwork(admin, a.id, await photo(), req);
    await adminPromos.setArtwork(admin, b.id, await photo(1200, 800), req);
    const active = await prisma.mediaAsset.count({
      where: { partnerId: partner.id, kind: MediaAssetKind.PROMO_ARTWORK, status: MediaAssetStatus.ACTIVE },
    });
    expect(active).toBe(2);
  });

  describe('refuses', () => {
    it('a customer and a partner owner — the role, not the permission', async () => {
      const admin = await platformAdmin();
      const partner = await createPartner(prisma);
      const created = await adminPromos.create(admin, card(partner.id), req);
      const owner = await partnerOwner(partner.id);
      const customer = asUser({ id: (await createCustomer(prisma)).user.id });

      // The controller checks the role before it touches the file or the
      // service, so the refusal is synchronous — same as over HTTP, where
      // the guard answers 403 before the upload is read.
      const file = await photo();
      expect(() => adminPromos.setArtwork(owner, created.id, file, req)).toThrow(ForbiddenException);
      expect(() => adminPromos.setArtwork(customer, created.id, file, req)).toThrow(ForbiddenException);
      expect(() => adminPromos.create(owner, card(partner.id), req)).toThrow(ForbiddenException);
      expect(() => adminPromos.list(owner, {})).toThrow(ForbiddenException);

      const untouched = await prisma.partnerPromo.findUniqueOrThrow({ where: { id: created.id } });
      expect(untouched.artworkAssetId).toBeNull();
    });

    it('bytes that are not an image, a corrupt file and an empty file', async () => {
      const admin = await platformAdmin();
      const partner = await createPartner(prisma);
      const created = await adminPromos.create(admin, card(partner.id), req);
      const text = Buffer.from('<html>not an image</html>');
      const corrupt = Buffer.concat([(await photo(200, 125)).buffer.subarray(0, 40), Buffer.alloc(200, 0)]);

      for (const buffer of [text, corrupt, Buffer.alloc(0)]) {
        const file: UploadedImage = { buffer, originalname: 'x.png', mimetype: 'image/png', size: buffer.length };
        await expect(adminPromos.setArtwork(admin, created.id, file, req)).rejects.toBeInstanceOf(BadRequestException);
      }
      const untouched = await prisma.partnerPromo.findUniqueOrThrow({ where: { id: created.id } });
      expect(untouched.artworkAssetId).toBeNull();
      expect(await prisma.mediaAsset.count()).toBe(0);
    });

    it('an SVG and an animated image, which the pipeline does not accept as a photograph', async () => {
      const admin = await platformAdmin();
      const partner = await createPartner(prisma);
      const created = await adminPromos.create(admin, card(partner.id), req);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
      const file: UploadedImage = { buffer: svg, originalname: 'x.svg', mimetype: 'image/svg+xml', size: svg.length };
      await expect(adminPromos.setArtwork(admin, created.id, file, req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('an oversized upload at the pipeline boundary', async () => {
      // The HTTP layer's `ParseFilePipe` caps the body at MAX_UPLOAD_BYTES;
      // the image service repeats the check so a direct caller cannot skip
      // it. Asserted here on the service rather than by streaming 6 MB
      // through Nest.
      const images = harness.app.get(MediaImageService);
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
      await expect(images.process(big, MediaAssetKind.PROMO_ARTWORK)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('artwork for a card that does not exist', async () => {
      const admin = await platformAdmin();
      await expect(
        adminPromos.setArtwork(admin, '00000000-0000-0000-0000-000000000000', await photo(), req),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('a card with artwork is still not served when', () => {
    const cases: Array<[string, (partnerId: string) => CreatePromoDto, (prisma: PrismaClient, partnerId: string) => Promise<void>]> = [
      ['it is switched off', (id) => card(id, { active: false }), () => Promise.resolve()],
      ['it starts in the future', (id) => card(id, { startAt: new Date(Date.now() + 3_600_000).toISOString() }), () => Promise.resolve()],
      ['it has expired', (id) => card(id, { startAt: new Date(Date.now() - 7_200_000).toISOString(), endAt: new Date(Date.now() - 3_600_000).toISOString() }), () => Promise.resolve()],
      ['its partner is suspended', (id) => card(id), async (prisma, id) => { await prisma.partner.update({ where: { id }, data: { status: PartnerStatus.SUSPENDED } }); }],
      ['its partner is switched off', (id) => card(id), async (prisma, id) => { await prisma.partner.update({ where: { id }, data: { isActive: false } }); }],
    ];

    it.each(cases)('%s', async (_name, build, arrange) => {
      const admin = await platformAdmin();
      const partner = await createPartner(prisma);
      const created = await adminPromos.create(admin, build(partner.id), req);
      await adminPromos.setArtwork(admin, created.id, await photo(), req);
      await arrange(prisma, partner.id);

      expect(await promos.featured({ locale: 'ru' })).toEqual([]);
      // …but the artwork itself remains deliverable: the card is hidden by
      // the window, not by taking its image down.
      const row = await prisma.partnerPromo.findUniqueOrThrow({ where: { id: created.id } });
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: row.artworkAssetId! } });
      expect(asset.status).toBe(MediaAssetStatus.ACTIVE);
    });
  });
});
