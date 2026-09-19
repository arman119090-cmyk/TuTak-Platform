import type { MediaImageDto } from './media';

/**
 * Home "Partner Spotlight" — curated featured-partner placements.
 *
 * Not an advertising platform: each card is written by a platform
 * administrator, who chooses its artwork and when it runs. The app never
 * hardcodes a partner here; it renders whatever `GET /promos/featured`
 * returns, and renders nothing at all when that is empty.
 */

/** Where a tap lands. Into the product only — never a free URL. */
export type PartnerPromoDestination = 'PARTNER' | 'PARTNERS_MAP';

/** What the app shows. No counters, no schedule — only what a card needs. */
export interface PartnerPromoPublicDto {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerLogo: MediaImageDto | null;
  title: string;
  subtitle: string | null;
  /** The concrete benefit the card leads with: "10% кешбэк", "−15%". */
  benefitLabel: string;
  artwork: MediaImageDto | null;
  destination: PartnerPromoDestination;
  /** A paid placement — the card carries a small "Promo" mark. */
  sponsored: boolean;
}

/** The management view: everything, including what is not live and why. */
export interface PartnerPromoAdminDto extends PartnerPromoPublicDto {
  active: boolean;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  /** Computed server-side from `active`, the partner's state and the window. */
  live: boolean;
  impressionCount: number;
  openCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerPromoRequestDto {
  partnerId: string;
  title: string;
  subtitle?: string | null;
  benefitLabel: string;
  destination?: PartnerPromoDestination;
  sponsored?: boolean;
  active?: boolean;
  priority?: number;
  /** ISO 8601, or null for "from now". */
  startAt?: string | null;
  /** ISO 8601, or null for "until switched off". */
  endAt?: string | null;
}

export type UpdatePartnerPromoRequestDto = Partial<Omit<CreatePartnerPromoRequestDto, 'partnerId'>>;

/**
 * The two things the app reports about a card. An impression is counted only
 * when the card was actually on screen — not when it arrived from the API.
 */
export type PartnerPromoEventType = 'IMPRESSION' | 'OPEN';

export interface PartnerPromoEventRequestDto {
  type: PartnerPromoEventType;
}
