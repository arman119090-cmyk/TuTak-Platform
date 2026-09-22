import type {
  AuthenticatedUserDto,
  BonusLedgerEntryDto,
  BonusLotDto,
  EvSessionDto,
  EvStationDto,
  NearbyPartnerDto,
  NotificationDto,
  PartnerBrandDto,
  PartnerPromoPublicDto,
  PurchaseIntentDto,
  ReferralCodeDto,
  ReferralInviteDto,
  TransactionDto,
} from '@tutak/shared-types';
import { MOCK_PROMO_ARTWORK } from './mockPromoArtwork';
import {
  BonusEntryStatus,
  BonusEntryType,
  Currency,
  EvConnectorStatus,
  EvConnectorType,
  EvSessionStatus,
  EvStationProvider,
  LedgerDirection,
  PartnerCategory,
  ReferralInviteStatus,
  Role,
  TransactionStatus,
  TransactionType,
} from '@tutak/shared-types';

/**
 * The data the app shows when there is no server.
 *
 * This exists so the interface can be looked at on a phone with nothing
 * installed but Expo Go — no database, no API, no configuration. See
 * `mockAdapter.ts` for how it is served and `preview/README.md` for how it is
 * run.
 *
 * It is deliberately shaped like real data rather than like a placeholder:
 * amounts that are not round, a wallet whose buckets add up, a history whose
 * entries are consistent with that wallet, a charging session in progress.
 * A screen looks correct on `1 000` and wrong on `1 234.56`, and the point of
 * looking at it is to find out which.
 *
 * Dates are computed relative to launch so nothing reads as stale.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

export const MOCK_USER: AuthenticatedUserDto = {
  id: 'mock-user-1',
  phone: '+37477100001',
  email: null,
  firstName: 'Ани',
  lastName: 'Петросян',
  roles: [Role.CUSTOMER],
  partnerScopes: {},
  locale: 'ru',
  isPhoneVerified: true,
  // Offline, there is nothing to serve an avatar from — see MOCK_BRANDS on
  // why a fabricated URL would be worse than none. `UserAvatar` renders its
  // neutral mark, which is what a real account without a photo shows.
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
  mustChangePassword: false,
};

export function mockTokens() {
  return {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    accessTokenExpiresAt: daysAhead(1),
    refreshTokenExpiresAt: daysAhead(30),
  };
}

/**
 * Mutable, because the app writes as well as reads.
 *
 * Paying a QR code, stopping a charge and reading a notification all change
 * something, and a preview where those actions leave the screen exactly as it
 * was teaches the wrong thing about the product. The state lives for as long
 * as the app is open and resets on reload, which is the right lifetime for
 * something being looked at rather than used.
 */
export interface MockState {
  /** The stored money balance (hybrid funding). Money, not points — kept apart from `wallet`. */
  prepaidAvailable: string;
  wallet: {
    id: string;
    userId: string;
    availableBonus: string;
    pendingBonus: string;
    reservedBonus: string;
    lifetimeEarned: string;
    lifetimeSpent: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  ledger: BonusLedgerEntryDto[];
  /**
   * The signed-in customer, mutable — the avatar and the referral-list
   * consent flag are both editable from the Profile screen now, so this can
   * no longer be the frozen `MOCK_USER` constant.
   */
  user: AuthenticatedUserDto;
  lots: BonusLotDto[];
  transactions: TransactionDto[];
  partners: NearbyPartnerDto[];
  stations: EvStationDto[];
  sessions: EvSessionDto[];
  notifications: NotificationDto[];
  referralCode: ReferralCodeDto;
  invites: ReferralInviteDto[];
  purchaseIntents: PurchaseIntentDto[];
  /**
   * The Home "Partner Spotlight" strip, as `GET /promos/featured` returns it
   * for `ru`. The other two languages live in `MOCK_PROMO_COPY`; the adapter
   * swaps the copy for the `locale` the app asks for, falling back exactly
   * as the API does (requested → ru → first filled).
   */
  promos: PartnerPromoPublicDto[];
}

/**
 * The three cards' words per interface language. The third card has no
 * Armenian on purpose: the Armenian interface then shows its Russian copy,
 * which is the fallback the API applies and the thing a reviewer should be
 * able to see happen.
 */
export const MOCK_PROMO_COPY: Record<string, Partial<Record<'hy' | 'ru' | 'en', { title: string; subtitle: string | null; benefitLabel: string }>>> = {
  'promo-1': {
    hy: { title: 'Սուրճ տանելու՝ 10% հետ', subtitle: 'Ամեն օր մինչև 12:00', benefitLabel: '10% քեշբեք' },
    ru: { title: 'Кофе с собой — 10% обратно', subtitle: 'Каждый день до 12:00', benefitLabel: '10% кешбэк' },
    en: { title: 'Coffee to go — 10% back', subtitle: 'Every day until 12:00', benefitLabel: '10% cashback' },
  },
  'promo-2': {
    hy: { title: 'Շաբաթվա մթերքը՝ բոնուսներով', subtitle: 'Ցանցի բոլոր խանութներում', benefitLabel: '5% քեշբեք' },
    ru: { title: 'Продукты на неделю — с бонусами', subtitle: 'Во всех магазинах сети', benefitLabel: '5% кешбэк' },
    en: { title: 'A week of groceries — with bonus', subtitle: 'In every store of the chain', benefitLabel: '5% cashback' },
  },
  'promo-3': {
    ru: { title: 'Ночная зарядка дешевле', subtitle: 'С 23:00 до 07:00 на всех станциях', benefitLabel: '−15%' },
    en: { title: 'Night charging costs less', subtitle: '23:00–07:00 at every station', benefitLabel: '−15%' },
  },
};

const WALLET_ID = 'mock-wallet-1';

/**
 * The mock partners' brands, keyed by partner id.
 *
 * `logo: null` throughout, and deliberately: the mock adapter replaces the
 * transport, not the CDN — it has no server to serve derivatives from, and
 * inventing a URL would produce the one thing
 * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §6 forbids, a broken image. Null renders
 * `PartnerMark`'s neutral mark, which is exactly what a real partner that has
 * not uploaded a logo shows.
 *
 * The *names* are real, and that is the part that matters offline: the demo
 * exercises the brand-snapshot code path end to end, so a history row reads
 * "Ջազվե" rather than "QR_PAYMENT".
 */
const MOCK_BRANDS: Record<string, PartnerBrandDto> = {
  'partner-1': { partnerId: 'partner-1', displayName: 'Ջազվե', logo: null },
  'partner-2': { partnerId: 'partner-2', displayName: 'Երևան Սիթի', logo: null },
  'partner-3': { partnerId: 'partner-3', displayName: 'TuTak Charge', logo: null },
};

export const mockBrandFor = (partnerId: string | null): PartnerBrandDto | null =>
  partnerId ? (MOCK_BRANDS[partnerId] ?? null) : null;

function ledgerEntry(
  over: Partial<BonusLedgerEntryDto> & Pick<BonusLedgerEntryDto, 'id' | 'type' | 'direction' | 'amount' | 'balanceAfter' | 'createdAt'>,
): BonusLedgerEntryDto {
  return {
    walletId: WALLET_ID,
    availableDelta: '0',
    pendingDelta: '0',
    reservedDelta: '0',
    relatedLotId: null,
    relatedReservationId: null,
    sourceTransactionId: null,
    metadata: null,
    partnerBrand: null,
    ...over,
  };
}

export function freshMockState(): MockState {
  return {
    user: { ...MOCK_USER },
    prepaidAvailable: '25000.0000',
    wallet: {
      id: WALLET_ID,
      userId: MOCK_USER.id,
      availableBonus: '377.5',
      pendingBonus: '120',
      reservedBonus: '0',
      lifetimeEarned: '647.5',
      lifetimeSpent: '150',
      version: 7,
      createdAt: daysAgo(120),
      updatedAt: minutesAgo(20),
    },

    // Consistent with the wallet above: 75 + 302.5 available, 120 pending.
    lots: [
      {
        id: 'lot-1',
        walletId: WALLET_ID,
        type: BonusEntryType.ACCRUAL_REFERRAL,
        status: BonusEntryStatus.AVAILABLE,
        originalAmount: '75',
        remainingAmount: '75',
        sourceTransactionId: null,
        availableAt: daysAgo(30),
        expiresAt: daysAhead(90),
        createdAt: daysAgo(30),
      },
      {
        id: 'lot-2',
        walletId: WALLET_ID,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        status: BonusEntryStatus.AVAILABLE,
        originalAmount: '302.5',
        remainingAmount: '302.5',
        sourceTransactionId: 'tx-1',
        availableAt: daysAgo(1),
        expiresAt: daysAhead(364),
        createdAt: daysAgo(1),
      },
      {
        id: 'lot-3',
        walletId: WALLET_ID,
        type: BonusEntryType.ACCRUAL_PURCHASE,
        status: BonusEntryStatus.PENDING,
        originalAmount: '120',
        remainingAmount: '120',
        sourceTransactionId: 'tx-2',
        availableAt: daysAhead(6),
        expiresAt: daysAhead(371),
        createdAt: minutesAgo(20),
      },
    ],

    // Includes the two NEUTRAL kinds on purpose — a transfer between the
    // wallet's own buckets is exactly the row that used to be rendered as a
    // loss, and it should be visible in a preview.
    ledger: [
      ledgerEntry({
        id: 'led-1',
        type: BonusEntryType.ACCRUAL_PURCHASE,
        direction: LedgerDirection.CREDIT,
        amount: '120',
        pendingDelta: '120',
        balanceAfter: '497.5',
        relatedLotId: 'lot-3',
        sourceTransactionId: 'tx-2',
        createdAt: minutesAgo(20),
      }),
      ledgerEntry({
        id: 'led-2',
        type: BonusEntryType.PENDING_PROMOTION,
        direction: LedgerDirection.NEUTRAL,
        amount: '302.5',
        pendingDelta: '-302.5',
        availableDelta: '302.5',
        balanceAfter: '377.5',
        relatedLotId: 'lot-2',
        createdAt: daysAgo(1),
      }),
      ledgerEntry({
        id: 'led-3',
        type: BonusEntryType.ACCRUAL_PURCHASE,
        direction: LedgerDirection.CREDIT,
        amount: '302.5',
        pendingDelta: '302.5',
        balanceAfter: '377.5',
        relatedLotId: 'lot-2',
        sourceTransactionId: 'tx-1',
        createdAt: daysAgo(2),
      }),
      ledgerEntry({
        id: 'led-4',
        type: BonusEntryType.REDEMPTION_QR_PAYMENT,
        direction: LedgerDirection.DEBIT,
        amount: '150',
        availableDelta: '-150',
        balanceAfter: '75',
        sourceTransactionId: 'tx-3',
        createdAt: daysAgo(9),
      }),
      ledgerEntry({
        id: 'led-5',
        type: BonusEntryType.RESERVE_HOLD,
        direction: LedgerDirection.NEUTRAL,
        amount: '150',
        availableDelta: '-150',
        reservedDelta: '150',
        balanceAfter: '225',
        createdAt: daysAgo(9),
      }),
      ledgerEntry({
        id: 'led-6',
        type: BonusEntryType.ACCRUAL_REFERRAL,
        direction: LedgerDirection.CREDIT,
        amount: '75',
        availableDelta: '75',
        balanceAfter: '225',
        relatedLotId: 'lot-1',
        createdAt: daysAgo(30),
      }),
    ],

    transactions: [
      {
        id: 'tx-2',
        userId: MOCK_USER.id,
        partnerId: 'partner-1',
        partnerBrand: mockBrandFor('partner-1'),
        type: TransactionType.QR_PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: '2400',
        currency: Currency.AMD,
        bonusAppliedAmount: '0',
        bonusEarnedAmount: '120',
        purchaseIntentId: null,
        branch: null,
        description: 'Кафе «Ջազվե»',
        metadata: null,
        createdAt: minutesAgo(20),
        updatedAt: minutesAgo(20),
      },
      {
        id: 'tx-1',
        userId: MOCK_USER.id,
        partnerId: 'partner-2',
        partnerBrand: mockBrandFor('partner-2'),
        type: TransactionType.QR_PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: '6050',
        currency: Currency.AMD,
        bonusAppliedAmount: '0',
        bonusEarnedAmount: '302.5',
        purchaseIntentId: null,
        branch: null,
        description: 'Супермаркет «Երևան Սիթի»',
        metadata: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
      {
        id: 'tx-4',
        userId: MOCK_USER.id,
        partnerId: 'partner-3',
        partnerBrand: mockBrandFor('partner-3'),
        type: TransactionType.EV_CHARGING,
        status: TransactionStatus.COMPLETED,
        amount: '3180',
        currency: Currency.AMD,
        bonusAppliedAmount: '0',
        bonusEarnedAmount: '95.4',
        purchaseIntentId: null,
        branch: null,
        description: 'Зарядка · Республики',
        metadata: null,
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      },
      {
        id: 'tx-3',
        userId: MOCK_USER.id,
        partnerId: 'partner-1',
        partnerBrand: mockBrandFor('partner-1'),
        type: TransactionType.QR_PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: '4500',
        currency: Currency.AMD,
        bonusAppliedAmount: '150',
        bonusEarnedAmount: '225',
        purchaseIntentId: null,
        branch: { id: 'branch-1', name: 'Северный проспект', address: 'Северный пр. 1' },
        description: 'Кафе «Ջազվե»',
        metadata: null,
        createdAt: daysAgo(9),
        updatedAt: daysAgo(9),
      },
      {
        id: 'tx-5',
        userId: MOCK_USER.id,
        partnerId: 'partner-2',
        partnerBrand: mockBrandFor('partner-2'),
        type: TransactionType.REFUND,
        status: TransactionStatus.COMPLETED,
        amount: '1200',
        currency: Currency.AMD,
        bonusAppliedAmount: '0',
        bonusEarnedAmount: '0',
        purchaseIntentId: null,
        branch: null,
        description: 'Возврат · Երևան Սիթի',
        metadata: null,
        createdAt: daysAgo(14),
        updatedAt: daysAgo(14),
      },
    ],

    /*
     * Partners a demo can actually browse.
     *
     * Real streets in Yerevan, with coordinates that put the pins where those
     * streets are — a map is the one screen where placeholder data is
     * immediately obvious, because twelve partners stacked on one point looks
     * exactly like a broken projection.
     *
     * `distanceKm` is measured from Republic Square, which is where
     * `useApproximateLocation` centres the map. The server computes this per
     * request; here it is precomputed, and the adapter re-sorts by it so the
     * demo's ordering is the product's ordering.
     */
    partners: [
      {
        id: 'branch-1',
        partnerId: 'partner-sas',
        name: 'SAS Supermarket',
        branchName: 'Северный проспект',
        category: PartnerCategory.GROCERY,
        address: 'пр. Северный, 3',
        city: 'Ереван',
        latitude: 40.1793,
        longitude: 44.5148,
        cashbackPercent: 5,
        highCashback: true,
        distanceKm: 0.3,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-2',
        partnerId: 'partner-sas',
        name: 'SAS Supermarket',
        branchName: 'Комитаса',
        category: PartnerCategory.GROCERY,
        address: 'пр. Комитаса, 25',
        city: 'Ереван',
        latitude: 40.1985,
        longitude: 44.493,
        cashbackPercent: 5,
        highCashback: true,
        distanceKm: 2.9,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-3',
        partnerId: 'partner-yerevancity',
        name: 'Yerevan City',
        branchName: 'Маштоца',
        category: PartnerCategory.GROCERY,
        address: 'пр. Маштоца, 50',
        city: 'Ереван',
        latitude: 40.1855,
        longitude: 44.5075,
        cashbackPercent: 4,
        highCashback: false,
        distanceKm: 1.0,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-4',
        partnerId: 'partner-greenbean',
        name: 'Green Bean',
        branchName: 'Абовяна',
        category: PartnerCategory.CAFE,
        address: 'ул. Абовяна, 22',
        city: 'Ереван',
        latitude: 40.1855,
        longitude: 44.517,
        cashbackPercent: 10,
        highCashback: true,
        distanceKm: 1.0,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-5',
        partnerId: 'partner-coffeeshop',
        name: 'Coffeeshop Company',
        branchName: 'Северный',
        category: PartnerCategory.CAFE,
        address: 'пр. Северный, 1',
        city: 'Ереван',
        latitude: 40.1788,
        longitude: 44.5142,
        cashbackPercent: 8,
        highCashback: true,
        distanceKm: 0.2,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-6',
        partnerId: 'partner-dolmama',
        name: 'Dolmama',
        branchName: 'Пушкина',
        category: PartnerCategory.RESTAURANT,
        address: 'ул. Пушкина, 10',
        city: 'Ереван',
        latitude: 40.1848,
        longitude: 44.5133,
        cashbackPercent: 7,
        highCashback: true,
        distanceKm: 0.8,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-7',
        partnerId: 'partner-parma',
        name: 'Parma',
        branchName: 'Абовяна',
        category: PartnerCategory.RESTAURANT,
        address: 'ул. Абовяна, 15',
        city: 'Ереван',
        latitude: 40.1832,
        longitude: 44.5162,
        cashbackPercent: 6,
        highCashback: true,
        distanceKm: 0.7,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-8',
        partnerId: 'partner-natali',
        name: 'Natali Pharm',
        branchName: 'Туманяна',
        category: PartnerCategory.PHARMACY,
        address: 'ул. Туманяна, 8',
        city: 'Ереван',
        latitude: 40.1836,
        longitude: 44.5138,
        cashbackPercent: 3,
        highCashback: false,
        distanceKm: 0.7,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-9',
        partnerId: 'partner-alfapharm',
        name: 'Alfa-Pharm',
        branchName: 'Комитаса',
        category: PartnerCategory.PHARMACY,
        address: 'пр. Комитаса, 25',
        city: 'Ереван',
        latitude: 40.1975,
        longitude: 44.499,
        cashbackPercent: 3,
        highCashback: false,
        distanceKm: 2.5,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-10',
        partnerId: 'partner-flash',
        name: 'Flash',
        branchName: 'Аршакуняц',
        category: PartnerCategory.FUEL,
        address: 'пр. Аршакуняц, 41',
        city: 'Ереван',
        latitude: 40.1618,
        longitude: 44.4941,
        cashbackPercent: 2,
        highCashback: false,
        distanceKm: 2.4,
        logo: null,
        cover: null,
        sellsGas: true,
        sellsPetrol: true,
        recommended: false,
      },
      {
        id: 'branch-11',
        partnerId: 'partner-anahit',
        name: 'Studio Anahit',
        branchName: 'Саят-Нова',
        category: PartnerCategory.BEAUTY,
        address: 'пр. Саят-Нова, 20',
        city: 'Ереван',
        latitude: 40.1861,
        longitude: 44.5202,
        cashbackPercent: 12,
        highCashback: true,
        distanceKm: 1.1,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
      {
        id: 'branch-12',
        partnerId: 'partner-3',
        name: 'TuTak Charge',
        branchName: 'Площадь Республики',
        category: PartnerCategory.EV_CHARGING,
        address: 'пл. Республики, 1',
        city: 'Ереван',
        latitude: 40.1776,
        longitude: 44.5126,
        cashbackPercent: 6,
        highCashback: true,
        distanceKm: 0.0,
        logo: null,
        cover: null,
        sellsGas: false,
        sellsPetrol: false,
        recommended: false,
      },
    ],

    stations: [
      {
        id: 'station-1',
        partnerId: 'partner-3',
        name: 'Площадь Республики',
        address: 'пл. Республики, 1',
        city: 'Ереван',
        latitude: 40.1776,
        longitude: 44.5126,
        ocpiLocationId: 'LOC-1',
        provider: EvStationProvider.INTERNAL,
        externalStationId: null,
        standardRetailRatePerKwh: null,
        connectors: [
          {
            id: 'conn-1',
            stationId: 'station-1',
            ocpiEvseUid: 'EVSE-1',
            externalConnectorId: null,
            connectorType: EvConnectorType.TYPE_2,
            status: EvConnectorStatus.AVAILABLE,
            powerKw: 22,
            pricePerKwh: '78',
          },
          {
            id: 'conn-2',
            stationId: 'station-1',
            ocpiEvseUid: 'EVSE-2',
            externalConnectorId: null,
            connectorType: EvConnectorType.CCS2,
            status: EvConnectorStatus.CHARGING,
            powerKw: 60,
            pricePerKwh: '95',
          },
        ],
      },
      {
        id: 'station-2',
        partnerId: 'partner-3',
        name: 'Каскад',
        address: 'ул. Таманяна, 10',
        city: 'Ереван',
        latitude: 40.1899,
        longitude: 44.5152,
        ocpiLocationId: 'LOC-2',
        provider: EvStationProvider.INTERNAL,
        externalStationId: null,
        standardRetailRatePerKwh: null,
        connectors: [
          {
            id: 'conn-3',
            stationId: 'station-2',
            ocpiEvseUid: 'EVSE-3',
            externalConnectorId: null,
            connectorType: EvConnectorType.CHADEMO,
            status: EvConnectorStatus.AVAILABLE,
            powerKw: 50,
            pricePerKwh: '88',
          },
        ],
      },
      {
        id: 'station-3',
        partnerId: 'partner-3',
        name: 'Севанское шоссе',
        address: 'М4, 42 км',
        city: 'Севан',
        latitude: 40.5533,
        longitude: 44.9511,
        ocpiLocationId: 'LOC-3',
        provider: EvStationProvider.INTERNAL,
        externalStationId: null,
        standardRetailRatePerKwh: null,
        connectors: [
          {
            id: 'conn-4',
            stationId: 'station-3',
            ocpiEvseUid: 'EVSE-4',
            externalConnectorId: null,
            connectorType: EvConnectorType.TYPE_2,
            status: EvConnectorStatus.OUTOFORDER,
            powerKw: 22,
            pricePerKwh: '78',
          },
        ],
      },
    ],

    // Finished, not running.
    //
    // It used to start already charging, on the reasoning that the charging
    // screen would then have something to show. What it actually did was open
    // the demonstration halfway through the story: a banner saying "charging
    // now" sits above the station list, and the first thing somebody looks for
    // — how do I connect and start — is the one thing they cannot find,
    // because from the app's point of view they already did it.
    //
    // A completed session gives the history screen something real and leaves
    // the interesting path walkable: pick a station, pick a bay, start, watch
    // it charge, stop it.
    sessions: [
      {
        id: 'session-1',
        connectorId: 'conn-2',
        userId: MOCK_USER.id,
        status: EvSessionStatus.COMPLETED,
        startedAt: minutesAgo(94),
        stoppedAt: minutesAgo(24),
        energyKwh: '11.4',
        cost: '1083',
        bonusEarned: '32.49',
        ocpiCdrId: null,
      },
    ],

    notifications: [
      {
        id: 'note-1',
        userId: MOCK_USER.id,
        channel: 'IN_APP',
        titleKey: 'notifications.bonusEarned.title',
        bodyKey: 'notifications.bonusEarned.body',
        params: { amount: 120 },
        isRead: false,
        createdAt: minutesAgo(20),
      },
      {
        id: 'note-2',
        userId: MOCK_USER.id,
        channel: 'IN_APP',
        titleKey: 'notifications.chargingStarted.title',
        bodyKey: 'notifications.chargingStarted.body',
        params: { station: 'Площадь Республики' },
        isRead: false,
        createdAt: minutesAgo(24),
      },
      {
        id: 'note-3',
        userId: MOCK_USER.id,
        channel: 'IN_APP',
        titleKey: 'notifications.bonusExpiring.title',
        bodyKey: 'notifications.bonusExpiring.body',
        params: { amount: 75, days: 90 },
        isRead: true,
        createdAt: daysAgo(3),
      },
    ],

    referralCode: {
      code: 'TT-ANI2026',
      userId: MOCK_USER.id,
      totalInvites: 3,
      totalRewardedInvites: 1,
      createdAt: daysAgo(120),
    },

    invites: [
      {
        id: 'inv-1',
        referrerUserId: MOCK_USER.id,
        refereeUserId: 'mock-user-2',
        referee: { id: 'mock-user-2', firstName: 'Давид', lastName: 'Петросян' , avatar: null },
        status: ReferralInviteStatus.REWARDED,
        qualifyingAction: 'QR_PAYMENT',
        rewardAmount: '75',
        createdAt: daysAgo(32),
        qualifiedAt: daysAgo(30),
      },
      {
        id: 'inv-2',
        referrerUserId: MOCK_USER.id,
        refereeUserId: 'mock-user-3',
        referee: { id: 'mock-user-3', firstName: 'Мариам', lastName: 'Хачатрян' , avatar: null },
        status: ReferralInviteStatus.PENDING,
        qualifyingAction: null,
        rewardAmount: null,
        createdAt: daysAgo(4),
        qualifiedAt: null,
      },
      {
        id: 'inv-3',
        referrerUserId: MOCK_USER.id,
        refereeUserId: 'mock-user-4',
        referee: { id: 'mock-user-4', firstName: 'Гор', lastName: 'Саргсян' , avatar: null },
        status: ReferralInviteStatus.EXPIRED,
        qualifyingAction: null,
        rewardAmount: null,
        createdAt: daysAgo(70),
        qualifiedAt: null,
      },
    ],

    purchaseIntents: [],

    /*
     * Three featured placements, already filtered and ordered the way the
     * server returns them — the app never decides what is live, it only
     * draws what it is given. Partners are three of the twelve on the map,
     * so a tap lands on real branches; `partnerLogo` is null throughout for
     * the reason `MOCK_BRANDS` gives. One is marked sponsored so the small
     * "Promo" mark can be seen in the preview.
     */
    promos: [
      {
        id: 'promo-1',
        partnerId: 'partner-coffeeshop',
        partnerName: 'Coffeeshop Company',
        partnerLogo: null,
        locale: 'ru',
        title: 'Кофе с собой — 10% обратно',
        subtitle: 'Каждый день до 12:00',
        benefitLabel: '10% кешбэк',
        artwork: { assetId: 'promo-art-1', url: MOCK_PROMO_ARTWORK.cafe, thumbnailUrl: MOCK_PROMO_ARTWORK.cafe, width: 720, height: 450 },
        destination: 'PARTNER',
        sponsored: true,
      },
      {
        id: 'promo-2',
        partnerId: 'partner-sas',
        partnerName: 'SAS Supermarket',
        partnerLogo: null,
        locale: 'ru',
        title: 'Продукты на неделю — с бонусами',
        subtitle: 'Во всех магазинах сети',
        benefitLabel: '5% кешбэк',
        artwork: { assetId: 'promo-art-2', url: MOCK_PROMO_ARTWORK.market, thumbnailUrl: MOCK_PROMO_ARTWORK.market, width: 720, height: 450 },
        destination: 'PARTNER',
        sponsored: false,
      },
      {
        id: 'promo-3',
        partnerId: 'partner-3',
        partnerName: 'TuTak Charge',
        partnerLogo: null,
        locale: 'ru',
        title: 'Ночная зарядка дешевле',
        subtitle: 'С 23:00 до 07:00 на всех станциях',
        benefitLabel: '−15%',
        artwork: { assetId: 'promo-art-3', url: MOCK_PROMO_ARTWORK.charge, thumbnailUrl: MOCK_PROMO_ARTWORK.charge, width: 720, height: 450 },
        destination: 'PARTNERS_MAP',
        sponsored: false,
      },
    ],
  };
}
