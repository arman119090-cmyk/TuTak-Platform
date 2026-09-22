import type { MediaImageDto } from './media';
import type { BranchFuelType } from '../enums/partner-branch';

/**
 * One row of a partner's optional public product/service list — the priced
 * products/services half of the public profile settled by the product
 * decision of 2026-08-23. Read-only from the customer's side: there is
 * deliberately no "add to cart"/"order" affordance anywhere this is
 * rendered — see
 * `docs/PARTNER_PROFILE_2026-08-23.md`.
 */
export interface PartnerOfferingDto {
  id: string;
  name: string;
  description: string | null;
  /** AMD, implicit — same convention as every other money string in this
   * package (see `CreatePurchaseIntentRequestDto.grossAmount`). */
  price: string;
}

/**
 * One of a partner's own physical locations — spec: partner self-service
 * branches (product decision, 2026-08-26). Unlike `PartnerOfferingDto`, this is not a
 * bulk-replace list: `isActive` lets a partner close a branch without
 * deleting it, because `PurchaseIntent`/`PartnerIntegration` history keeps
 * referencing it by id.
 */
export interface PartnerBranchDto {
  id: string;
  partnerId: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  /** Meaningful only for a `fuel`-category partner — see `PartnerBranch.fuelType`. */
  fuelType?: BranchFuelType | null;
  createdAt: string;
}

/**
 * What any authenticated caller sees.
 *
 * A customer needs the directory to find where their points are worth
 * something, so this is readable by everyone — which is exactly why it must
 * not carry tax IDs, individually negotiated commission rates, or the fact
 * that a business is currently blocked from being paid.
 */
export interface PartnerPublicDto {
  id: string;
  displayName: string;
  category: string;
  /**
   * Meaningful only when `category` is `"fuel"` — whether this station sells
   * gas (propane and methane counted as one bucket) and/or petrol. A real
   * station commonly sells both, so these are two independent flags rather
   * than one choice.
   */
  sellsGas: boolean;
  sellsPetrol: boolean;
  /** The cashback rate. Advertised by the partner; the customer is owed it. */
  bonusAccrualRateBps: number;
  /**
   * How much of a bill this partner lets bonus points cover, 0-100.
   *
   * A published term of trade, not a commercial secret — unlike
   * `paymentCommissionRateBps`, which stays on `PartnerDto`. It is the one
   * number that decides whether the amount a customer types on the purchase
   * screen will be accepted, and while it lived on the private projection
   * only, the first time anyone learned a restaurant caps bonus at 30% was
   * being refused at the till.
   */
  maxBonusPaymentPercent: number;
  /**
   * Whether this business is trading, and if not, which kind of not.
   *
   * `isActive` alone cannot say: an application still awaiting a decision
   * and a business switched off for fraud are both `false`. A client
   * holding a deep link to a partner page needs to tell "not open yet"
   * from "no longer with us", and both from a partner that is simply fine.
   */
  status: PartnerStatus;
  isActive: boolean;
  createdAt: string;
  /**
   * The partner's published logo, or null when it has none — spec §1.3/§4.
   *
   * Only ever an ACTIVE asset a platform administrator has confirmed: a
   * submission still in `PENDING_REVIEW` is deliberately invisible here, so an
   * owner-account compromise cannot change a public business identity on its
   * own (spec §1). Null is the ordinary case for a partner that has not
   * uploaded one, and the client renders the neutral mark.
   */
  logo: MediaImageDto | null;
  /** Optional wide cover for the detail card. Same approval rule as `logo`. */
  cover: MediaImageDto | null;
  /**
   * The partner's own "about" text, or null when they haven't written one.
   * Freeform, partner-entered content — same as `displayName` — so it is
   * never translated and rendered exactly as submitted. Live the instant the
   * partner saves it; unlike `logo`/`cover` there is no admin review step.
   */
  about: string | null;
  /**
   * Optional product/service list, oldest-first replacement order — see
   * `PartnerOfferingItem.displayOrder`. Empty, never omitted, when the
   * partner has listed nothing: the mobile client's contract is "hide the
   * section on an empty array", not "handle a missing field".
   */
  offerings: PartnerOfferingDto[];
}

/**
 * The full record. Returned only to a holder of PARTNER_MANAGE, or to the
 * partner's own people reading their own row.
 */
/**
 * Where a partner is in its life, which is not the same question as
 * `isActive`.
 *
 * `status` says whether this business was ever admitted to the platform;
 * `isActive` says whether an admitted one is trading today. A pending
 * application and a partner suspended this morning are both "not trading",
 * and telling them apart is the difference between a queue to work through
 * and an incident to look into.
 */
export type PartnerStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface PartnerDto extends PartnerPublicDto {
  legalName: string;
  /** The Armenian ՀՎՀՀ. Null until the partner supplies it — see `Partner.taxId`. */
  taxId: string | null;
  paymentCommissionRateBps: number;
  payoutsBlockedAt: string | null;
  payoutsBlockedReason: string | null;
  updatedAt: string;
}

export interface CreatePartnerRequestDto {
  legalName: string;
  displayName: string;
  taxId?: string;
  category: string;
  bonusAccrualRateBps: number;
  ownerUserId: string;
  sellsGas?: boolean;
  sellsPetrol?: boolean;
}

export interface PartnerAnalyticsDto {
  partnerId: string;
  periodFrom: string;
  periodTo: string;
  totalTransactions: number;
  /** Gross — everything rung up in the period, refunds included. */
  totalRevenue: string;
  /**
   * Merchandise value handed back against those purchases.
   *
   * A refund is a new record pointing back at the original, because
   * postings are immutable — it changes neither the transaction's amount
   * nor its COMPLETED status. So `totalRevenue` alone counted a fully
   * refunded dinner as revenue, and nothing in this payload said otherwise:
   * there was no figure to subtract and no sign one was missing.
   */
  totalRefunded: string;
  /** `totalRevenue` less `totalRefunded` — what the partner actually sold. */
  netRevenue: string;
  totalBonusIssued: string;
  totalBonusRedeemed: string;
  uniqueCustomers: number;
}

/**
 * A place a customer can walk into, as the customer's app sees it.
 *
 * Deliberately not `PartnerDto`. That one carries the legal name, the tax id,
 * the platform's commission and whether payouts are blocked — a partner's own
 * business, and none of a shopper's. This is what a shopper needs to decide
 * where to go: the name on the sign, what they get back, and how far it is.
 *
 * One entry per *branch*, not per partner: a chain with four shops is four
 * pins on a map, and the distance is the whole point of the screen.
 */
export interface NearbyPartnerDto {
  /** The branch. Distinct from `partnerId` — a chain shares the latter. */
  id: string;
  partnerId: string;
  /** The name on the sign, never the legal one. */
  name: string;
  /** Which branch of it, e.g. "Northern Avenue". */
  branchName: string;
  category: PartnerCategory;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  /**
   * What the customer earns here, as a percentage — 5 means 5%.
   *
   * Converted from basis points on the server rather than in the client. The
   * client showing "300%" because it forgot to divide is exactly the class of
   * mistake this codebase has already shipped once, in the other direction.
   */
  cashbackPercent: number;
  /** Straight-line kilometres from the point asked about, to one decimal. */
  distanceKm: number;
  /**
   * True when this partner gives noticeably more back than the ordinary
   * offer, at `HIGH_CASHBACK_PERCENT` or above.
   *
   * It exists so that choosing a generous rate buys a partner something real
   * rather than a number nobody compares. The threshold lives on the server
   * so it can be retuned without waiting for an app release, and so every
   * client agrees on what "generous" means today.
   */
  highCashback: boolean;
  /**
   * The chain's published logo — spec §1.3's "catalogue/map card".
   *
   * Per *partner*, not per branch: a chain's four shops are four pins with one
   * identity, and a branch does not have a logo of its own. Null when the
   * partner has published none, which every partner that predates the media
   * system does.
   */
  logo: MediaImageDto | null;
  /** The chain's published cover, for the partner detail card. */
  cover: MediaImageDto | null;
  /** See `PartnerPublicDto.sellsGas`/`sellsPetrol` — meaningful only when `category` is `"fuel"`. */
  sellsGas: boolean;
  sellsPetrol: boolean;
  /**
   * True when this branch's category is one the customer actually spends
   * in — only ever computed when they opted in via
   * `personalizedRecommendationsEnabled`; always false otherwise. Ranked
   * ahead of the rest of the list, never filtered out — turning this on
   * never hides a nearby shop, it only reorders what was already there.
   */
  recommended: boolean;
}

/**
 * The categories a customer can filter by.
 *
 * A closed set, because it drives an icon and a filter chip — an unknown
 * string would render as a blank pin. `OTHER` is where anything unrecognised
 * lands, so a new category on the server degrades to a visible generic entry
 * rather than to nothing at all.
 */
export enum PartnerCategory {
  GROCERY = 'grocery',
  CAFE = 'cafe',
  RESTAURANT = 'restaurant',
  PHARMACY = 'pharmacy',
  FUEL = 'fuel',
  EV_CHARGING = 'ev_charging',
  BEAUTY = 'beauty',
  OTHER = 'other',
}

/**
 * The `fuel`-category sub-filter — "Газ" (propane and methane, counted as
 * one) vs "Бензин" (product decision, 2026-08-26). Not part of `PartnerCategory`: every
 * `fuel` partner keeps that one category, and this narrows the search within
 * it via `sellsGas`/`sellsPetrol` rather than widening the category set.
 */
export enum FuelType {
  GAS = 'gas',
  PETROL = 'petrol',
}
