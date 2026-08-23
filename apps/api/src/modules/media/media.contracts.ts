/**
 * The media response shapes, restated for the API.
 *
 * The canonical declarations live in
 * `packages/shared-types/src/dto/media.ts`, which is what every client
 * compiles against. The API cannot import that package: its `rootDir` is
 * `apps/api/src` and a cross-workspace import fails the build with TS6059 —
 * the same constraint that forces `modules/partners/geo.ts` to keep its own
 * copy of the partner-category list, and for the same reason.
 *
 * So these are hand-kept mirrors. `media-contracts.spec.ts` compiles under
 * the spec tsconfig, which *can* see both trees, and asserts they still agree
 * — a drift here would otherwise surface as a mobile screen silently reading
 * a field the server stopped sending.
 */

export type MediaAssetKindDto = 'USER_AVATAR' | 'PARTNER_LOGO' | 'PARTNER_COVER';

export type MediaAssetStatusDto = 'PENDING_REVIEW' | 'ACTIVE' | 'REPLACED' | 'REVOKED';

export interface MediaImageDto {
  assetId: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

export interface PartnerBrandDto {
  partnerId: string;
  displayName: string;
  logo: MediaImageDto | null;
}

export interface MediaAssetDto {
  id: string;
  kind: MediaAssetKindDto;
  status: MediaAssetStatusDto;
  partnerId: string | null;
  userId: string | null;
  width: number;
  height: number;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  approvedAt: string | null;
  uploadedByUserId: string | null;
  approvedByUserId: string | null;
  preview: MediaImageDto;
}

export interface PartnerMediaDto {
  partnerId: string;
  displayName: string;
  logo: MediaAssetDto | null;
  cover: MediaAssetDto | null;
  pending: MediaAssetDto[];
}

export interface UpdateAvatarConsentRequestDto {
  showAvatarInReferralList: boolean;
}
