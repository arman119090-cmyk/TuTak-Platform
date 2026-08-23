import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaAssetStatus, PrismaClient, RoleName } from '@prisma/client';
import sharp from 'sharp';
import type { Request } from 'express';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { MediaDeliveryController } from '../src/modules/media/media-delivery.controller';
import { PartnerMediaController, type UploadedImage } from '../src/modules/media/partner-media.controller';
import { UserAvatarController } from '../src/modules/media/user-avatar.controller';
import { AdminMediaController } from '../src/modules/media/admin-media.controller';
import { PartnersController } from '../src/modules/partners/partners.controller';
import { PurchaseIntentsController } from '../src/modules/purchase-intents/purchase-intents.controller';
import { ReferralService } from '../src/modules/referral/referral.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { createCustomer, createPartner } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * The media system's authorisation and history rules, against the real
 * database and the real image pipeline.
 *
 * Only the storage backend is a fake, per spec §3.2 — the bytes go into
 * memory instead of a bucket, and nothing else about the path changes. Every
 * refusal asserted here is a refusal the deployed code makes for the same
 * reason at the same place.
 */
describe('Media system (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let partnerMedia: PartnerMediaController;
  let userAvatar: UserAvatarController;
  let adminMedia: AdminMediaController;
  let delivery: MediaDeliveryController;
  let partners: PartnersController;
  let intents: PurchaseIntentsController;
  let referral: ReferralService;
  let transactions: TransactionsService;

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

  const owner = (userId: string, partnerId: string) =>
    asUser({
      id: userId,
      roles: [RoleName.PARTNER_OWNER],
      partnerScopes: { [RoleName.PARTNER_OWNER]: [partnerId] },
    });

  const admin = (userId: string) => asUser({ id: userId, roles: [RoleName.SUPER_ADMIN] });

  /** A real PNG, distinguishable from the next one by its size. */
  async function png(size: number, alpha = true): Promise<UploadedImage> {
    const buffer = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: size % 255, g: 90, b: 140, alpha: alpha ? 1 : 1 },
      },
    })
      .png()
      .toBuffer();
    return { buffer, originalname: 'logo.png', mimetype: 'image/png', size: buffer.length };
  }

  /** A captured `res`, so the delivery routes can be driven without HTTP. */
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

  const query = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());
  const assetIdOf = (url: string) => new URL(url).pathname.split('/').at(-2)!;
  const variantOf = (url: string) => new URL(url).pathname.split('/').at(-1)!;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    partnerMedia = harness.app.get(PartnerMediaController);
    userAvatar = harness.app.get(UserAvatarController);
    adminMedia = harness.app.get(AdminMediaController);
    delivery = harness.app.get(MediaDeliveryController);
    partners = harness.app.get(PartnersController);
    intents = harness.app.get(PurchaseIntentsController);
    referral = harness.app.get(ReferralService);
    transactions = harness.app.get(TransactionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // ── Spec §1 / §6: the two-party rule ──────────────────────────────────

  describe('a partner owner submits, only an administrator publishes', () => {
    it('an owner’s upload lands PENDING_REVIEW and is invisible to customers', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);

      const submitted = await partnerMedia.putLogo(
        owner(user.id, partner.id),
        partner.id,
        await png(300),
        req,
      );
      expect(submitted.status).toBe(MediaAssetStatus.PENDING_REVIEW);

      const seenByCustomer = await partners.get(asUser({ id: shopper.id }), partner.id);
      expect(seenByCustomer).toHaveProperty('logo', null);

      // And the pointer on the partner row is untouched — nothing is live.
      const row = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
      expect(row.logoAssetId).toBeNull();
    });

    it('an owner cannot approve their own submission', async () => {
      const partner = await createPartner(prisma);
      const { user } = await createCustomer(prisma);
      const submitted = await partnerMedia.putLogo(
        owner(user.id, partner.id),
        partner.id,
        await png(300),
        req,
      );

      await expect(
        partnerMedia.approve(owner(user.id, partner.id), partner.id, submitted.id, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an owner cannot touch another partner’s media', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const { user } = await createCustomer(prisma);

      await expect(
        partnerMedia.putLogo(owner(user.id, mine.id), theirs.id, await png(300), req),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        partnerMedia.list(owner(user.id, mine.id), theirs.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an approval by an id belonging to another partner is refused, not confused', async () => {
      const a = await createPartner(prisma, { displayName: 'A' });
      const b = await createPartner(prisma, { displayName: 'B' });
      const { user: ownerA } = await createCustomer(prisma);
      const { user: platformAdmin } = await createCustomer(prisma);

      const submitted = await partnerMedia.putLogo(
        owner(ownerA.id, a.id),
        a.id,
        await png(300),
        req,
      );
      // Right asset id, wrong partner in the path.
      await expect(
        partnerMedia.approve(admin(platformAdmin.id), b.id, submitted.id, req),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an administrator’s own upload publishes immediately', async () => {
      const partner = await createPartner(prisma);
      const { user: platformAdmin } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);

      const uploaded = await partnerMedia.putLogo(
        admin(platformAdmin.id),
        partner.id,
        await png(300),
        req,
      );
      expect(uploaded.status).toBe(MediaAssetStatus.ACTIVE);

      const seen = await partners.get(asUser({ id: shopper.id }), partner.id);
      expect((seen as { logo: { assetId: string } | null }).logo?.assetId).toBe(uploaded.id);
    });

    it('approval publishes the submission and lists it in the queue beforehand', async () => {
      const partner = await createPartner(prisma);
      const { user: shopOwner } = await createCustomer(prisma);
      const { user: platformAdmin } = await createCustomer(prisma);

      const submitted = await partnerMedia.putLogo(
        owner(shopOwner.id, partner.id),
        partner.id,
        await png(300),
        req,
      );

      const queue = await adminMedia.pending(admin(platformAdmin.id));
      expect(queue.map((r) => r.id)).toContain(submitted.id);

      const approved = await partnerMedia.approve(
        admin(platformAdmin.id),
        partner.id,
        submitted.id,
        req,
      );
      expect(approved.status).toBe(MediaAssetStatus.ACTIVE);
      expect(approved.approvedByUserId).toBe(platformAdmin.id);

      const emptyQueue = await adminMedia.pending(admin(platformAdmin.id));
      expect(emptyQueue.map((r) => r.id)).not.toContain(submitted.id);
    });

    it('a second submission supersedes the first rather than queueing both', async () => {
      const partner = await createPartner(prisma);
      const { user: shopOwner } = await createCustomer(prisma);
      const { user: platformAdmin } = await createCustomer(prisma);
      const first = await partnerMedia.putLogo(owner(shopOwner.id, partner.id), partner.id, await png(300), req);
      const second = await partnerMedia.putLogo(owner(shopOwner.id, partner.id), partner.id, await png(320), req);

      const queue = await adminMedia.pending(admin(platformAdmin.id));
      const ids = queue.map((r) => r.id);
      expect(ids).toContain(second.id);
      expect(ids).not.toContain(first.id);
    });

    it('only an administrator may take a published logo down', async () => {
      const partner = await createPartner(prisma);
      const { user: shopOwner } = await createCustomer(prisma);
      const { user: platformAdmin } = await createCustomer(prisma);
      await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(300), req);

      await expect(
        partnerMedia.deleteLogo(owner(shopOwner.id, partner.id), partner.id, req),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const removed = await partnerMedia.deleteLogo(admin(platformAdmin.id), partner.id, req);
      expect(removed.revokedAssetId).toBeTruthy();
      const row = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
      expect(row.logoAssetId).toBeNull();
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: removed.revokedAssetId! } });
      // Retained, per spec §3.3 — the record is not deleted, only withdrawn.
      expect(asset.status).toBe(MediaAssetStatus.REVOKED);
    });
  });

  // ── Spec §2.2 / §6: historical brand snapshots ────────────────────────

  describe('an operation keeps the brand it was created under', () => {
    it('a PurchaseIntent and its transaction survive a rebrand', async () => {
      const partner = await createPartner(prisma, { displayName: 'Jazzve Coffee' });
      const { user: platformAdmin } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);

      const logoV1 = await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(300), req);

      const intent = await intents.create(asUser({ id: shopper.id }), {
        partnerId: partner.id,
        grossAmount: '5000',
      } as never);
      expect(intent.partnerBrand.logo?.assetId).toBe(logoV1.id);
      expect(intent.partnerBrand.displayName).toBe('Jazzve Coffee');

      // The partner rebrands, and renames itself for good measure.
      const logoV2 = await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(320), req);
      await prisma.partner.update({ where: { id: partner.id }, data: { displayName: 'Jazzve' } });
      expect(logoV2.id).not.toBe(logoV1.id);

      // The directory shows the new brand...
      const card = await partners.get(asUser({ id: shopper.id }), partner.id);
      expect((card as { logo: { assetId: string } | null }).logo?.assetId).toBe(logoV2.id);

      // ...and the already-created intent shows the old one.
      const reread = await intents.get(asUser({ id: shopper.id }), intent.id);
      expect(reread.partnerBrand.logo?.assetId).toBe(logoV1.id);
      expect(reread.partnerBrand.displayName).toBe('Jazzve Coffee');

      // The superseded asset is retained and still deliverable — that is the
      // whole mechanism, and it is what stops history breaking.
      const old = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: logoV1.id } });
      expect(old.status).toBe(MediaAssetStatus.REPLACED);
      const captured = fakeRes();
      await delivery.brand(logoV1.id, 'display', captured.res);
      expect(captured.body?.length).toBeGreaterThan(0);
      expect(captured.headers['cache-control']).toContain('immutable');
    });

    it('a transaction snapshots the brand at creation, once', async () => {
      const partner = await createPartner(prisma, { displayName: 'SAS' });
      const { user: platformAdmin } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);
      const logoV1 = await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(300), req);

      const txn = await transactions.create({
        userId: shopper.id,
        partnerId: partner.id,
        type: 'PARTNER_PURCHASE',
        amount: '1200',
      });
      expect(txn.brandDisplayName).toBe('SAS');
      expect(txn.brandLogoAssetId).toBe(logoV1.id);

      await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(340), req);

      const history = await transactions.history({ userId: shopper.id, limit: 20 } as never);
      const row = history.items.find((i) => i.id === txn.id)!;
      expect(row.partnerBrand?.logo?.assetId).toBe(logoV1.id);
      expect(row.partnerBrand?.displayName).toBe('SAS');
    });

    it('a refund carries the source operation’s brand, not today’s', async () => {
      const partner = await createPartner(prisma, { displayName: 'Original Name' });
      const { user: platformAdmin } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);
      const logoV1 = await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(300), req);

      const original = await transactions.create({
        userId: shopper.id,
        partnerId: partner.id,
        type: 'PARTNER_PURCHASE',
        amount: '4000',
      });

      // Rebrand between the sale and the refund.
      await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(360), req);
      await prisma.partner.update({ where: { id: partner.id }, data: { displayName: 'New Name' } });

      const reversal = await transactions.create({
        userId: shopper.id,
        partnerId: partner.id,
        type: 'REFUND',
        amount: '4000',
        // Spec §2.2: a reversal resolves to the source operation's snapshot.
        brand: { displayName: original.brandDisplayName!, logoAssetId: original.brandLogoAssetId },
      });
      expect(reversal.brandDisplayName).toBe('Original Name');
      expect(reversal.brandLogoAssetId).toBe(logoV1.id);
    });

    it('a row written before the media system still names its partner', async () => {
      const partner = await createPartner(prisma, { displayName: 'Legacy Shop' });
      const { user: shopper } = await createCustomer(prisma);
      // Exactly what a pre-migration row looks like: partner set, snapshot null.
      const legacy = await prisma.transaction.create({
        data: {
          userId: shopper.id,
          partnerId: partner.id,
          type: 'QR_PAYMENT',
          amount: '900',
        },
      });

      const history = await transactions.history({ userId: shopper.id, limit: 20 } as never);
      const row = history.items.find((i) => i.id === legacy.id)!;
      expect(row.partnerBrand?.displayName).toBe('Legacy Shop');
      // Deliberately not backfilled with today's logo — that would assert the
      // partner had a logo at a time when it demonstrably did not.
      expect(row.partnerBrand?.logo).toBeNull();
    });

    it('a revoked asset drops out of history but the name survives', async () => {
      const partner = await createPartner(prisma, { displayName: 'Withdrawn Brand' });
      const { user: platformAdmin } = await createCustomer(prisma);
      const { user: shopper } = await createCustomer(prisma);
      await partnerMedia.putLogo(admin(platformAdmin.id), partner.id, await png(300), req);

      const txn = await transactions.create({
        userId: shopper.id,
        partnerId: partner.id,
        type: 'PARTNER_PURCHASE',
        amount: '700',
      });
      await partnerMedia.deleteLogo(admin(platformAdmin.id), partner.id, req);

      const history = await transactions.history({ userId: shopper.id, limit: 20 } as never);
      const row = history.items.find((i) => i.id === txn.id)!;
      expect(row.partnerBrand?.displayName).toBe('Withdrawn Brand');
      expect(row.partnerBrand?.logo).toBeNull();
      await expect(delivery.brand(txn.brandLogoAssetId!, 'display', fakeRes().res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── Spec §1.4 / §6: avatars and the consent rule ──────────────────────

  describe('a customer’s avatar', () => {
    it('is uploadable, replaceable and removable by its owner only', async () => {
      const { user } = await createCustomer(prisma);
      const first = await userAvatar.upload(asUser({ id: user.id }), await png(300), req);
      expect(first.url).toContain('/media/private/');

      // Replacement is the same PUT again — there is deliberately no second
      // route for it, so a client cannot get the two out of step.
      const second = await userAvatar.upload(asUser({ id: user.id }), await png(320), req);
      expect(second.assetId).not.toBe(first.assetId);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.avatarAssetId).toBe(second.assetId);
      const superseded = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: first.assetId } });
      expect(superseded.status).toBe(MediaAssetStatus.REPLACED);

      const removed = await userAvatar.remove(asUser({ id: user.id }), req);
      expect(removed.removedAssetId).toBe(second.assetId);
      const cleared = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(cleared.avatarAssetId).toBeNull();
    });

    it('cannot be fetched by anyone else, signature or not', async () => {
      const { user } = await createCustomer(prisma);
      const { user: stranger } = await createCustomer(prisma);
      const avatar = await userAvatar.upload(asUser({ id: user.id }), await png(300), req);

      const own = fakeRes();
      await delivery.private(
        avatar.assetId,
        'display',
        query(avatar.url).aud,
        query(avatar.url).exp,
        query(avatar.url).sig,
        own.res,
      );
      expect(own.body?.length).toBeGreaterThan(0);
      expect(own.headers['cache-control']).toContain('private');

      // A stranger cannot mint a signature, and swapping the audience in a
      // valid one breaks the HMAC.
      await expect(
        delivery.private(
          avatar.assetId,
          'display',
          stranger.id,
          query(avatar.url).exp,
          query(avatar.url).sig,
          fakeRes().res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is never served through the public brand route', async () => {
      const { user } = await createCustomer(prisma);
      const avatar = await userAvatar.upload(asUser({ id: user.id }), await png(300), req);
      await expect(delivery.brand(avatar.assetId, 'display', fakeRes().res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('the original derivative is never a delivery target', async () => {
      const { user } = await createCustomer(prisma);
      const avatar = await userAvatar.upload(asUser({ id: user.id }), await png(300), req);
      await expect(
        delivery.private(avatar.assetId, 'original', user.id, '9999999999', 'x', fakeRes().res),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the Level-1 consent rule', () => {
    async function chainOf(prismaClient: PrismaClient) {
      const { user: referrer } = await createCustomer(prismaClient);
      const { user: referee } = await createCustomer(prismaClient);
      await prismaClient.referralInvite.create({
        data: { referrerUserId: referrer.id, refereeUserId: referee.id, referrerType: 'USER' },
      });
      return { referrer, referee };
    }

    it('withholds the avatar until the referred person opts in', async () => {
      const { referrer, referee } = await chainOf(prisma);
      await userAvatar.upload(asUser({ id: referee.id }), await png(300), req);

      let list = await referral.listMyInvites(referrer.id);
      expect(list[0]!.referee?.avatar).toBeNull();

      await userAvatar.consent(asUser({ id: referee.id }), { showAvatarInReferralList: true }, req);
      list = await referral.listMyInvites(referrer.id);
      expect(list[0]!.referee?.avatar?.url).toContain('/media/private/');
    });

    it('lets the referrer fetch a consented avatar, and nobody else', async () => {
      const { referrer, referee } = await chainOf(prisma);
      const { user: outsider } = await createCustomer(prisma);
      await userAvatar.upload(asUser({ id: referee.id }), await png(300), req);
      await userAvatar.consent(asUser({ id: referee.id }), { showAvatarInReferralList: true }, req);

      const url = (await referral.listMyInvites(referrer.id))[0]!.referee!.avatar!.url;
      const q = query(url);
      const ok = fakeRes();
      await delivery.private(assetIdOf(url), variantOf(url) as never, q.aud, q.exp, q.sig, ok.res);
      expect(ok.body?.length).toBeGreaterThan(0);

      await expect(
        delivery.private(assetIdOf(url), variantOf(url) as never, outsider.id, q.exp, q.sig, fakeRes().res),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('invalidates an already-issued URL the moment consent is withdrawn', async () => {
      // The point of re-authorising on every delivery rather than trusting
      // the signature alone: a consent decision must take effect now, not at
      // the URL's expiry.
      const { referrer, referee } = await chainOf(prisma);
      await userAvatar.upload(asUser({ id: referee.id }), await png(300), req);
      await userAvatar.consent(asUser({ id: referee.id }), { showAvatarInReferralList: true }, req);
      const url = (await referral.listMyInvites(referrer.id))[0]!.referee!.avatar!.url;
      const q = query(url);

      await userAvatar.consent(asUser({ id: referee.id }), { showAvatarInReferralList: false }, req);
      await expect(
        delivery.private(assetIdOf(url), variantOf(url) as never, q.aud, q.exp, q.sig, fakeRes().res),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not let a Level-2 person’s avatar reach the Level-1 list', async () => {
      const { referrer, referee } = await chainOf(prisma);
      const { user: grandchild } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerUserId: referee.id, refereeUserId: grandchild.id, referrerType: 'USER' },
      });
      await userAvatar.upload(asUser({ id: grandchild.id }), await png(300), req);
      await userAvatar.consent(asUser({ id: grandchild.id }), { showAvatarInReferralList: true }, req);

      const list = await referral.listMyInvites(referrer.id);
      expect(list).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain(grandchild.id);
    });

    it('does not let a consented avatar be fetched by an indirect referrer', async () => {
      const { referrer, referee } = await chainOf(prisma);
      const { user: grandchild } = await createCustomer(prisma);
      await prisma.referralInvite.create({
        data: { referrerUserId: referee.id, refereeUserId: grandchild.id, referrerType: 'USER' },
      });
      await userAvatar.upload(asUser({ id: grandchild.id }), await png(300), req);
      await userAvatar.consent(asUser({ id: grandchild.id }), { showAvatarInReferralList: true }, req);

      // The L1 (direct) referrer of the grandchild is `referee`, and they can
      // see it. `referrer` is two hops up and must not, even holding the id.
      const direct = (await referral.listMyInvites(referee.id))[0]!.referee!.avatar!;
      const q = query(direct.url);
      await expect(
        delivery.private(direct.assetId, 'display', referrer.id, q.exp, q.sig, fakeRes().res),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('defaults to withheld', async () => {
      const { user } = await createCustomer(prisma);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.avatarConsentReferralList).toBe(false);
    });
  });

  // ── Spec §3.3: audit ──────────────────────────────────────────────────

  it('audits every media mutation with actor, target and asset', async () => {
    const partner = await createPartner(prisma);
    const { user: shopOwner } = await createCustomer(prisma);
    const { user: platformAdmin } = await createCustomer(prisma);

    const submitted = await partnerMedia.putLogo(owner(shopOwner.id, partner.id), partner.id, await png(300), req);
    await partnerMedia.approve(admin(platformAdmin.id), partner.id, submitted.id, req);
    await partnerMedia.deleteLogo(admin(platformAdmin.id), partner.id, req);
    await userAvatar.upload(asUser({ id: shopOwner.id }), await png(300), req);
    await userAvatar.consent(asUser({ id: shopOwner.id }), { showAvatarInReferralList: true }, req);

    const logs = await prisma.auditLog.findMany({
      where: { action: { in: ['MEDIA_ASSET_UPLOADED', 'MEDIA_ASSET_APPROVED', 'MEDIA_ASSET_REVOKED', 'MEDIA_AVATAR_CONSENT_CHANGED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual([
      'MEDIA_ASSET_UPLOADED',
      'MEDIA_ASSET_APPROVED',
      'MEDIA_ASSET_REVOKED',
      'MEDIA_ASSET_UPLOADED',
      'MEDIA_AVATAR_CONSENT_CHANGED',
    ]);
    expect(logs[0]!.actorUserId).toBe(shopOwner.id);
    expect(logs[0]!.entityId).toBe(submitted.id);
    expect(logs[1]!.actorUserId).toBe(platformAdmin.id);
  });

  // ── Spec §6: nothing breaks for a partner with no media ───────────────

  it('a partner with no media is a null logo everywhere, never a broken URL', async () => {
    const partner = await createPartner(prisma, { displayName: 'No Brand Yet' });
    const { user: shopper } = await createCustomer(prisma);

    const one = await partners.get(asUser({ id: shopper.id }), partner.id);
    expect(one).toMatchObject({ logo: null, cover: null });

    const all = await partners.list(asUser({ id: shopper.id }));
    expect(all.every((p) => (p as { logo: unknown }).logo === null)).toBe(true);

    const intent = await intents.create(asUser({ id: shopper.id }), {
      partnerId: partner.id,
      grossAmount: '1000',
    } as never);
    expect(intent.partnerBrand).toEqual({
      partnerId: partner.id,
      displayName: 'No Brand Yet',
      logo: null,
    });
  });
});
