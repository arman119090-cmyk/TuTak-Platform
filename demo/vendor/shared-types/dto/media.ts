/**
 * Media contracts — TUTAK_V2_MEDIA_SYSTEM_SPEC.md §4.
 *
 * Nothing in here is ever a storage key, a bucket path, or a caller-supplied
 * URL. What crosses the wire is a delivery reference the API minted and is
 * prepared to serve: for partner brand media a public, immutable, cacheable
 * URL, and for a customer avatar a short-lived signed one bound to the person
 * it was issued to. Spec §3.3 is explicit that private original-object keys
 * never reach a client, and the way to guarantee that is for the type system
 * to have nowhere to put one.
 */

export type MediaAssetKind = 'USER_AVATAR' | 'PARTNER_LOGO' | 'PARTNER_COVER';

export type MediaAssetStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'REPLACED' | 'REVOKED';

/**
 * One deliverable image, in the two sizes a client actually renders.
 *
 * Both URLs are absolute and both are safe to hand to an `<img>`/`<Image>`.
 * `width`/`height` describe `url` so a layout can reserve the space before the
 * bytes arrive — the difference between a card that settles and a list that
 * jumps as every logo loads.
 */
export interface MediaImageDto {
  assetId: string;
  /** The 1024px derivative. */
  url: string;
  /** The 128px derivative. Use this in any list row. */
  thumbnailUrl: string;
  width: number;
  height: number;
}

/**
 * A partner's identity as one customer-facing operation recorded it.
 *
 * Spec §2.2: history and detail views must render the brand the operation was
 * *created* under, not the partner's brand as it stands today. A partner that
 * rebrands, corrects a mistaken upload, or has an asset revoked must not
 * retroactively rewrite what a customer sees on a receipt from last March.
 *
 * `displayName` is always present — it is snapshotted alongside the logo, and
 * falls back to the partner's current name only for rows written before the
 * snapshot columns existed. `logo` is null whenever there is nothing safe to
 * show, which the client renders as the neutral mark: no logo was ever set, the
 * operation predates the media system, or the snapshotted asset has since been
 * revoked.
 */
export interface PartnerBrandDto {
  partnerId: string;
  displayName: string;
  logo: MediaImageDto | null;
}

/**
 * A media asset as its owner or a platform administrator sees it — the
 * partner branding page and the admin approval queue.
 *
 * `preview` is a signed, short-lived URL even for an asset that is already
 * public: these two surfaces show `PENDING_REVIEW` and `REVOKED` assets too,
 * and a single uniformly-authorised preview reference is one fewer place for a
 * caller to accidentally leak a not-yet-approved brand change.
 */
export interface MediaAssetDto {
  id: string;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
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

/** What `GET /partners/:id/media` returns to an owner or an administrator. */
export interface PartnerMediaDto {
  partnerId: string;
  displayName: string;
  /** The published logo, if any. */
  logo: MediaAssetDto | null;
  /** The published cover, if any. */
  cover: MediaAssetDto | null;
  /** Submissions waiting for a platform administrator. */
  pending: MediaAssetDto[];
}

/** Body of `PATCH /users/me/avatar-consent`. */
export interface UpdateAvatarConsentRequestDto {
  /**
   * Spec §1.4 / §3.3. Default false, and it governs exactly one thing: whether
   * this person's avatar may be rendered in their *direct* referrer's Level-1
   * list. No Level-2/3 surface, no partner-facing list and no admin response
   * treats it as permission to expose an avatar.
   */
  showAvatarInReferralList: boolean;
}
