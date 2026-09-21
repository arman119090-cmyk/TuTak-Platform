import type { LocalizedLabel } from '@/data/attributes';

/**
 * Commercial configuration: geography, delivery tariffs, service prices and
 * showrooms. All prices are in AMD minor units (= drams) and are the only
 * source of truth for the server-side order calculator.
 */

export type Region = {
  key: string;
  names: LocalizedLabel;
  /** Delivery tariff in minor units for a standard order. */
  deliveryMinor: number;
  /** Working days until delivery. */
  deliveryDays: number;
  cities: LocalizedLabel[];
};

export const REGIONS: Region[] = [
  {
    key: 'yerevan',
    names: { hy: 'Երևան', ru: 'Ереван', en: 'Yerevan' },
    deliveryMinor: 5_000,
    deliveryDays: 1,
    cities: [
      { hy: 'Կենտրոն', ru: 'Кентрон', en: 'Kentron' },
      { hy: 'Արաբկիր', ru: 'Арабкир', en: 'Arabkir' },
      { hy: 'Քանաքեռ-Զեյթուն', ru: 'Канакер-Зейтун', en: 'Kanaker-Zeytun' },
      { hy: 'Ավան', ru: 'Аван', en: 'Avan' },
      { hy: 'Դավթաշեն', ru: 'Давташен', en: 'Davtashen' },
      { hy: 'Աջափնյակ', ru: 'Аджапняк', en: 'Ajapnyak' },
      { hy: 'Մալաթիա-Սեբաստիա', ru: 'Малатия-Себастия', en: 'Malatia-Sebastia' },
      { hy: 'Շենգավիթ', ru: 'Шенгавит', en: 'Shengavit' },
      { hy: 'Էրեբունի', ru: 'Эребуни', en: 'Erebuni' },
      { hy: 'Նոր Նորք', ru: 'Нор Норк', en: 'Nor Nork' },
      { hy: 'Նուբարաշեն', ru: 'Нубарашен', en: 'Nubarashen' },
    ],
  },
  {
    key: 'kotayk',
    names: { hy: 'Կոտայք', ru: 'Котайк', en: 'Kotayk' },
    deliveryMinor: 9_000,
    deliveryDays: 2,
    cities: [
      { hy: 'Աբովյան', ru: 'Абовян', en: 'Abovyan' },
      { hy: 'Հրազդան', ru: 'Раздан', en: 'Hrazdan' },
      { hy: 'Չարենցավան', ru: 'Чаренцаван', en: 'Charentsavan' },
      { hy: 'Ծաղկաձոր', ru: 'Цахкадзор', en: 'Tsaghkadzor' },
    ],
  },
  {
    key: 'ararat',
    names: { hy: 'Արարատ', ru: 'Арарат', en: 'Ararat' },
    deliveryMinor: 10_000,
    deliveryDays: 2,
    cities: [
      { hy: 'Արտաշատ', ru: 'Арташат', en: 'Artashat' },
      { hy: 'Մասիս', ru: 'Масис', en: 'Masis' },
      { hy: 'Արարատ', ru: 'Арарат', en: 'Ararat' },
    ],
  },
  {
    key: 'armavir',
    names: { hy: 'Արմավիր', ru: 'Армавир', en: 'Armavir' },
    deliveryMinor: 10_000,
    deliveryDays: 2,
    cities: [
      { hy: 'Արմավիր', ru: 'Армавир', en: 'Armavir' },
      { hy: 'Էջմիածին', ru: 'Эчмиадзин', en: 'Ejmiatsin' },
      { hy: 'Մեծամոր', ru: 'Мецамор', en: 'Metsamor' },
    ],
  },
  {
    key: 'aragatsotn',
    names: { hy: 'Արագածոտն', ru: 'Арагацотн', en: 'Aragatsotn' },
    deliveryMinor: 12_000,
    deliveryDays: 3,
    cities: [
      { hy: 'Աշտարակ', ru: 'Аштарак', en: 'Ashtarak' },
      { hy: 'Թալին', ru: 'Талин', en: 'Talin' },
      { hy: 'Ապարան', ru: 'Апаран', en: 'Aparan' },
    ],
  },
  {
    key: 'shirak',
    names: { hy: 'Շիրակ', ru: 'Ширак', en: 'Shirak' },
    deliveryMinor: 16_000,
    deliveryDays: 3,
    cities: [
      { hy: 'Գյումրի', ru: 'Гюмри', en: 'Gyumri' },
      { hy: 'Արթիկ', ru: 'Артик', en: 'Artik' },
      { hy: 'Մարալիկ', ru: 'Маралик', en: 'Maralik' },
    ],
  },
  {
    key: 'lori',
    names: { hy: 'Լոռի', ru: 'Лори', en: 'Lori' },
    deliveryMinor: 15_000,
    deliveryDays: 3,
    cities: [
      { hy: 'Վանաձոր', ru: 'Ванадзор', en: 'Vanadzor' },
      { hy: 'Ալավերդի', ru: 'Алаверди', en: 'Alaverdi' },
      { hy: 'Սպիտակ', ru: 'Спитак', en: 'Spitak' },
      { hy: 'Ստեփանավան', ru: 'Степанаван', en: 'Stepanavan' },
    ],
  },
  {
    key: 'tavush',
    names: { hy: 'Տավուշ', ru: 'Тавуш', en: 'Tavush' },
    deliveryMinor: 16_000,
    deliveryDays: 4,
    cities: [
      { hy: 'Իջևան', ru: 'Иджеван', en: 'Ijevan' },
      { hy: 'Դիլիջան', ru: 'Дилижан', en: 'Dilijan' },
      { hy: 'Բերդ', ru: 'Берд', en: 'Berd' },
    ],
  },
  {
    key: 'gegharkunik',
    names: { hy: 'Գեղարքունիք', ru: 'Гегаркуник', en: 'Gegharkunik' },
    deliveryMinor: 14_000,
    deliveryDays: 3,
    cities: [
      { hy: 'Գավառ', ru: 'Гавар', en: 'Gavar' },
      { hy: 'Սևան', ru: 'Севан', en: 'Sevan' },
      { hy: 'Մարտունի', ru: 'Мартуни', en: 'Martuni' },
      { hy: 'Վարդենիս', ru: 'Варденис', en: 'Vardenis' },
    ],
  },
  {
    key: 'vayotsdzor',
    names: { hy: 'Վայոց ձոր', ru: 'Вайоц Дзор', en: 'Vayots Dzor' },
    deliveryMinor: 18_000,
    deliveryDays: 4,
    cities: [
      { hy: 'Եղեգնաձոր', ru: 'Ехегнадзор', en: 'Yeghegnadzor' },
      { hy: 'Վայք', ru: 'Вайк', en: 'Vayk' },
      { hy: 'Ջերմուկ', ru: 'Джермук', en: 'Jermuk' },
    ],
  },
  {
    key: 'syunik',
    names: { hy: 'Սյունիք', ru: 'Сюник', en: 'Syunik' },
    deliveryMinor: 22_000,
    deliveryDays: 4,
    cities: [
      { hy: 'Կապան', ru: 'Капан', en: 'Kapan' },
      { hy: 'Գորիս', ru: 'Горис', en: 'Goris' },
      { hy: 'Սիսիան', ru: 'Сисиан', en: 'Sisian' },
      { hy: 'Մեղրի', ru: 'Мегри', en: 'Meghri' },
    ],
  },
];

export const regionByKey = (key: string): Region | undefined =>
  REGIONS.find((region) => region.key === key);

/** Orders at or above this subtotal ship free anywhere in Armenia. */
export const FREE_DELIVERY_THRESHOLD_MINOR = 400_000;

export type ServiceKey = 'lift' | 'assembly' | 'doorInstall';

/**
 * Additional services. `perItem` multiplies by the number of cart lines that
 * need it; flat services are charged once per order.
 */
export const SERVICES: Record<
  ServiceKey,
  { priceMinor: number; perItem: boolean; names: LocalizedLabel; hint: LocalizedLabel }
> = {
  lift: {
    priceMinor: 4_000,
    perItem: false,
    names: { hy: 'Հարկ բարձրացնել', ru: 'Подъём на этаж', en: 'Carry up to the floor' },
    hint: {
      hy: 'Առանց վերելակի՝ 1 000 ֏ յուրաքանչյուր հարկի համար։',
      ru: 'Без лифта — 1 000 ֏ за каждый этаж сверху.',
      en: 'Without a lift — 1 000 ֏ per floor.',
    },
  },
  assembly: {
    priceMinor: 12_000,
    perItem: true,
    names: { hy: 'Կահույքի հավաքում', ru: 'Сборка мебели', en: 'Furniture assembly' },
    hint: {
      hy: 'Յուրաքանչյուր կահույքի միավորի համար՝ փաթեթավորման տեղափոխմամբ։',
      ru: 'За каждую единицу мебели, с вывозом упаковки.',
      en: 'Per furniture unit, packaging taken away.',
    },
  },
  doorInstall: {
    priceMinor: 25_000,
    perItem: true,
    names: { hy: 'Դռան տեղադրում', ru: 'Установка двери', en: 'Door installation' },
    hint: {
      hy: 'Մեկ դռան համար՝ շրջանակի և նալիչնիկների տեղադրմամբ։',
      ru: 'За одну дверь, включая монтаж коробки и наличников.',
      en: 'Per door, frame and casing fitted.',
    },
  },
};

/** Charged per extra floor when the building has no lift. */
export const LIFT_PER_FLOOR_MINOR = 1_000;

export const PICKUP_POINTS = [
  {
    key: 'showroom-mashtots',
    names: { hy: 'Շոուրում Մաշտոցի պող. 42', ru: 'Шоурум на пр. Маштоца 42', en: 'Mashtots Ave 42 showroom' },
    hours: '10:00 — 20:00',
  },
  {
    key: 'showroom-bagratunyats',
    names: { hy: 'Պահեստ-սրահ Բագրատունյաց 12', ru: 'Склад-салон на Багратуняц 12', en: 'Bagratunyats 12 warehouse' },
    hours: '10:00 — 19:00',
  },
];

export const DELIVERY_SLOTS = [
  { key: 'morning', names: { hy: '10:00 — 14:00', ru: '10:00 — 14:00', en: '10:00 — 14:00' } },
  { key: 'day', names: { hy: '14:00 — 18:00', ru: '14:00 — 18:00', en: '14:00 — 18:00' } },
  { key: 'evening', names: { hy: '18:00 — 21:00', ru: '18:00 — 21:00', en: '18:00 — 21:00' } },
];

/** Catalogue page size used by the storefront and the API. */
export const PAGE_SIZE = 24;

/** Maximum number of products that can be compared at once. */
export const COMPARE_LIMIT = 4;
