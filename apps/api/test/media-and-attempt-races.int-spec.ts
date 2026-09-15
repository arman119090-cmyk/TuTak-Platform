import { PrismaClient, MediaAssetKind, MediaAssetStatus, AuthOtpPurpose } from '@prisma/client';
import { AuthOtpService } from '../src/modules/auth/auth-otp.service';
import { MediaService } from '../src/modules/media/media.service';
import { MediaDeliveryController } from '../src/modules/media/media-delivery.controller';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Two findings from the audit that share a shape: something that was meant
 * to be bounded was not, because the check and the write were separable.
 */
describe('Media revocation and attempt counting (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let media: MediaService;
  let delivery: MediaDeliveryController;
  let otp: AuthOtpService;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    media = harness.app.get(MediaService);
    delivery = harness.app.get(MediaDeliveryController);
    otp = harness.app.get(AuthOtpService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(prisma);
  });

  describe('a revoked avatar stops being shown', () => {
    it('is refused to the person who was invited by its owner, and to the owner', async () => {
      // Revocation is what an administrator reaches for when the *file* must
      // stop being shown. It was applied to the public route and not to the
      // signed one, so a revoked avatar kept being served — including to the
      // referrer, which is somebody other than its owner seeing an image an
      // administrator had taken down.
      const { user: owner } = await createCustomer(prisma);
      const { user: referrer } = await createCustomer(prisma);
      await prisma.user.update({
        where: { id: owner.id },
        data: { avatarConsentReferralList: true },
      });
      await prisma.referralInvite.create({
        data: { referrerUserId: referrer.id, refereeUserId: owner.id },
      });

      const asset = await prisma.mediaAsset.create({
        data: {
          kind: MediaAssetKind.USER_AVATAR,
          status: MediaAssetStatus.ACTIVE,
          userId: owner.id,
          uploadedByUserId: owner.id,
          storageKey: 'k/o',
          displayKey: 'k/d',
          thumbnailKey: 'k/t',
          width: 10,
          height: 10,
          mimeType: 'image/webp',
          byteSize: 10,
          sha256: 'x'.repeat(64),
          approvedAt: new Date(),
        },
      });

      const mayView = (viewerId: string) =>
        (
          delivery as unknown as {
            mayStillView: (a: unknown, v: string) => Promise<boolean>;
          }
        ).mayStillView(asset, viewerId);

      // While it is live, both may see it — otherwise this test would pass
      // for the wrong reason.
      expect(await mayView(owner.id)).toBe(true);
      expect(await mayView(referrer.id)).toBe(true);

      const revoked = await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaAssetStatus.REVOKED, revokedAt: new Date() },
      });

      const mayViewRevoked = (viewerId: string) =>
        (
          delivery as unknown as {
            mayStillView: (a: unknown, v: string) => Promise<boolean>;
          }
        ).mayStillView(revoked, viewerId);

      expect(await mayViewRevoked(referrer.id)).toBe(false);
      expect(await mayViewRevoked(owner.id)).toBe(false);
    });
  });

  describe('a failed upload leaves nothing behind', () => {
    it('removes the objects already written when a later write fails', async () => {
      // Three writes in a row, outside the try that cleaned up. A failure on
      // the second or third left the ones before it in the bucket with no row
      // pointing at them — not just cost, but an untracked copy of somebody's
      // face sitting in storage outside every record the platform keeps.
      const { user } = await createCustomer(prisma);
      // Measured as a delta: the in-memory store is shared across the file,
      // and what matters is that this upload adds nothing, not that the
      // bucket happens to be empty.
      const before = harness.mediaStorage.size;

      let writes = 0;
      const realPut = harness.mediaStorage.put.bind(harness.mediaStorage);
      jest.spyOn(harness.mediaStorage, 'put').mockImplementation((async (
        ...args: Parameters<typeof realPut>
      ) => {
        writes += 1;
        if (writes === 2) throw new Error('the bucket went away mid-upload');
        return realPut(...args);
      }) as never);

      await expect(
        media.setUserAvatar({
          userId: user.id,
          file: await onePixelPng(),
          actor: { userId: user.id },
        }),
      ).rejects.toThrow();

      expect(await prisma.mediaAsset.count()).toBe(0);
      expect(harness.mediaStorage.size).toBe(before);
    });
  });

  describe('attempts are counted by the database, not by the process', () => {
    it('charges two wrong guesses two attempts, even when they overlap', async () => {
      // `attempts + 1` read the count and wrote back a number derived from
      // it. Two guesses that overlap both read the same value and both write
      // the same one, so the ceiling can be walked past by going parallel
      // instead of sequential.
      //
      // Driven, not raced: the first caller is held between reading the
      // challenge and writing its attempt, and the second is run to
      // completion in that window. A plain `Promise.all` here passes against
      // the broken code — the two calls simply do not overlap at the point
      // that matters, and the test proves nothing on the run where it passes.
      //
      // `arrived` is what makes "the first caller" mean the first caller.
      // The spy used to hold whichever call reached it first and the test
      // started the second without waiting, so the two raced for that slot
      // — and `consumeCode` does two awaits before `findFirst` (the
      // per-address budget, then the hourly aggregate), either of which can
      // be slower on the opening call while a connection is still cold. Lose
      // that race and the *second* call is the one parked on `held`, which
      // is released only after the second call returns: a deadlock, seen as
      // a 60-second timeout on a loaded CI runner and reproducible locally
      // by running this file on its own.
      const phone = '+37477123456';
      await otp.requestCode(phone, AuthOtpPurpose.REGISTER);

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached!: () => void;
      const arrived = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let heldOnce = false;
      const realFindFirst = prisma.authOtpToken.findFirst.bind(prisma.authOtpToken);
      const spy = jest.spyOn(prisma.authOtpToken, 'findFirst');
      spy.mockImplementation((async (args: never) => {
        if (heldOnce) return realFindFirst(args);
        heldOnce = true;
        const row = await realFindFirst(args);
        reached();
        await held;
        return row;
      }) as never);

      const first = otp
        .consumeCode(phone, AuthOtpPurpose.REGISTER, '000000')
        .catch(() => undefined);
      // Only once the first caller is demonstrably parked is there a window
      // for the second one to run inside.
      await arrived;
      await otp.consumeCode(phone, AuthOtpPurpose.REGISTER, '111111').catch(() => undefined);
      release();
      await first;

      const challenge = await prisma.authOtpToken.findFirstOrThrow({
        where: { phone, purpose: AuthOtpPurpose.REGISTER },
        orderBy: { createdAt: 'desc' },
      });
      expect(challenge.attempts).toBe(2);
    });
  });
});

/** The smallest thing the image pipeline will accept. */
async function onePixelPng(): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
}
