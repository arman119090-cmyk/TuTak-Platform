import { MediaAssetKind, MediaAssetStatus } from '@prisma/client';
import type {
  MediaAssetDto as SharedMediaAssetDto,
  MediaImageDto as SharedMediaImageDto,
  PartnerBrandDto as SharedPartnerBrandDto,
  PartnerMediaDto as SharedPartnerMediaDto,
  UpdateAvatarConsentRequestDto as SharedUpdateAvatarConsentRequestDto,
} from '@tutak/shared-types';
import type {
  MediaAssetDto,
  MediaAssetKindDto,
  MediaAssetStatusDto,
  MediaImageDto,
  PartnerBrandDto,
  PartnerMediaDto,
  UpdateAvatarConsentRequestDto,
} from './media.contracts';

/**
 * The API's hand-kept mirror of the shared media contracts must not drift.
 *
 * `apps/api` cannot import `@tutak/shared-types` in its *build* — its
 * `rootDir` is `apps/api/src` and the cross-workspace import fails with
 * TS6059 — so `media.contracts.ts` restates those interfaces locally, exactly
 * as `modules/partners/geo.ts` restates the partner-category list. This spec
 * compiles under `tsconfig.spec.json`, whose `rootDir` is the workspace root
 * and which can therefore see both trees at once.
 *
 * Most of the checking here is done by the compiler, not by an assertion: the
 * mutual assignments below fail the build the moment a field is added,
 * removed or retyped on one side only. The runtime assertions cover the one
 * thing types cannot — that the string unions still match the Prisma enums
 * they are derived from, which is where a new `MediaAssetKind` would
 * otherwise slip through silently.
 */
describe('media contracts stay in step with @tutak/shared-types', () => {
  it('MediaImageDto is structurally identical in both directions', () => {
    const local: MediaImageDto = { assetId: 'a', url: 'u', thumbnailUrl: 't', width: 1, height: 2 };
    const shared: SharedMediaImageDto = local;
    const back: MediaImageDto = shared;
    expect(back).toEqual(local);
  });

  it('PartnerBrandDto is structurally identical in both directions', () => {
    const local: PartnerBrandDto = { partnerId: 'p', displayName: 'n', logo: null };
    const shared: SharedPartnerBrandDto = local;
    const back: PartnerBrandDto = shared;
    expect(back).toEqual(local);
  });

  it('MediaAssetDto is structurally identical in both directions', () => {
    const local: MediaAssetDto = {
      id: 'a',
      kind: 'PARTNER_LOGO',
      status: 'ACTIVE',
      partnerId: 'p',
      userId: null,
      width: 1024,
      height: 1024,
      mimeType: 'image/webp',
      byteSize: 10,
      createdAt: '2026-08-23T00:00:00.000Z',
      approvedAt: null,
      uploadedByUserId: 'u',
      approvedByUserId: null,
      preview: { assetId: 'a', url: 'u', thumbnailUrl: 't', width: 1, height: 1 },
    };
    const shared: SharedMediaAssetDto = local;
    const back: MediaAssetDto = shared;
    expect(back).toEqual(local);
  });

  it('PartnerMediaDto and the consent request are identical in both directions', () => {
    const media: PartnerMediaDto = { partnerId: 'p', displayName: 'n', logo: null, cover: null, pending: [] };
    const sharedMedia: SharedPartnerMediaDto = media;
    const backMedia: PartnerMediaDto = sharedMedia;
    expect(backMedia).toEqual(media);

    const consent: UpdateAvatarConsentRequestDto = { showAvatarInReferralList: true };
    const sharedConsent: SharedUpdateAvatarConsentRequestDto = consent;
    const backConsent: UpdateAvatarConsentRequestDto = sharedConsent;
    expect(backConsent).toEqual(consent);
  });

  it('the DTO string unions cover exactly the Prisma enums', () => {
    // A new kind or status in schema.prisma without a matching arm in the
    // union would otherwise reach a client as a value it has no case for —
    // which is F-17 (an unlabelled database value rendered raw) all over
    // again, this time as a status pill with no label.
    const kinds: Record<MediaAssetKind, MediaAssetKindDto> = {
      USER_AVATAR: 'USER_AVATAR',
      PARTNER_LOGO: 'PARTNER_LOGO',
      PARTNER_COVER: 'PARTNER_COVER',
    };
    const statuses: Record<MediaAssetStatus, MediaAssetStatusDto> = {
      PENDING_REVIEW: 'PENDING_REVIEW',
      ACTIVE: 'ACTIVE',
      REPLACED: 'REPLACED',
      REVOKED: 'REVOKED',
    };
    expect(Object.keys(kinds).sort()).toEqual(Object.values(MediaAssetKind).sort());
    expect(Object.keys(statuses).sort()).toEqual(Object.values(MediaAssetStatus).sort());
  });
});
