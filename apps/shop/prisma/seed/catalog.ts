import { COLORS, MATERIALS } from '../../src/data/attributes';
import { productLeaves } from '../../src/data/taxonomy';
import { artworkUrl, type ArtVariant } from '../../src/lib/media/artwork';
import { createRng, slugify } from '../../src/lib/utils';
import {
  BODY_TEMPLATES,
  KIND_CLOSING,
  KIND_INTRO,
  SHORT_TEMPLATES,
  TYPE_NAMES,
  type ProductKind,
} from './text';

/**
 * Procedural catalogue generator.
 *
 * Everything is derived from a deterministic RNG seeded by the product index,
 * so `npm run seed` twice produces byte-identical data — which is what makes
 * the E2E tests and the screenshots in the README stable.
 */

export const BRANDS = [
  { slug: 'nairi-living', name: 'Nairi Living', country: 'AM', foundedYear: 2009, isPremium: true,
    tagline: { hy: 'Երևանյան արհեստանոց՝ 2009 թվականից', ru: 'Ереванская мастерская с 2009 года', en: 'A Yerevan workshop since 2009' },
    description: { hy: 'Մեր արտադրամասը Երևանում պատրաստում է փափուկ կահույք՝ եվրոպական ֆուռնիտուրայով և տեղական փայտով։', ru: 'Собственный цех в Ереване: мягкая мебель на европейской фурнитуре и местном дереве.', en: 'An in-house Yerevan workshop: upholstery on European hardware and local timber.' } },
  { slug: 'sevan-home', name: 'Sevan Home', country: 'AM', foundedYear: 2014, isPremium: false,
    tagline: { hy: 'Պարզ կահույք ամենօրյա կյանքի համար', ru: 'Простая мебель для каждого дня', en: 'Simple furniture for every day' },
    description: { hy: 'Հասանելի գներ և պահեստում առկա մոդելներ՝ առանց երկար սպասելու։', ru: 'Доступные цены и модели со склада — без долгого ожидания производства.', en: 'Accessible prices and stocked models — no long production wait.' } },
  { slug: 'ararat-craft', name: 'Ararat Craft', country: 'AM', foundedYear: 2004, isPremium: true,
    tagline: { hy: 'Փայտի զանգված և ձեռքի աշխատանք', ru: 'Массив дерева и ручная работа', en: 'Solid wood and hand craft' },
    description: { hy: 'Կաղնու և հացենու զանգվածից կահույք՝ ձեռքով հղկված և յուղով մշակված։', ru: 'Мебель из массива дуба и ясеня: ручная шлифовка, масляное покрытие.', en: 'Solid oak and ash furniture, hand-sanded and oil finished.' } },
  { slug: 'amberd', name: 'Amberd Furniture', country: 'AM', foundedYear: 2016, isPremium: false,
    tagline: { hy: 'Պահեստավորում փոքր բնակարանների համար', ru: 'Хранение для небольших квартир', en: 'Storage for small apartments' },
    description: { hy: 'Կոմպակտ պահարաններ և համակարգեր՝ մինչև 60 սմ խորությամբ։', ru: 'Компактные шкафы и системы хранения глубиной до 60 см.', en: 'Compact wardrobes and storage systems up to 60 cm deep.' } },
  { slug: 'vayk-studio', name: 'Vayk Studio', country: 'AM', foundedYear: 2019, isPremium: false,
    tagline: { hy: 'Ժամանակակից ձևեր, մատչելի գին', ru: 'Современные формы по доступной цене', en: 'Modern shapes at a fair price' },
    description: { hy: 'Երիտասարդ ստուդիա, որը նախագծում է կահույք փոքր բնակարանների համար։', ru: 'Молодая студия, проектирующая мебель под малогабаритные квартиры.', en: 'A young studio designing furniture for compact flats.' } },
  { slug: 'orbeli-design', name: 'Orbeli Design', country: 'AM', foundedYear: 2011, isPremium: true,
    tagline: { hy: 'Ավտորական դիզայն ինտերիերի համար', ru: 'Авторский дизайн для интерьера', en: 'Signature design pieces' },
    description: { hy: 'Սահմանափակ շարքեր՝ դիզայներների հետ համատեղ մշակված։', ru: 'Ограниченные серии, разработанные вместе с дизайнерами интерьера.', en: 'Limited runs developed together with interior designers.' } },
  { slug: 'tavush-oak', name: 'Tavush Oak', country: 'AM', foundedYear: 2007, isPremium: false,
    tagline: { hy: 'Տավուշյան կաղնի՝ սեղանների համար', ru: 'Тавушский дуб для столов и стульев', en: 'Tavush oak for tables and chairs' },
    description: { hy: 'Ճաշի խմբեր տեղական կաղնուց՝ ամուր և պարզ։', ru: 'Обеденные группы из местного дуба: прочно и без лишнего декора.', en: 'Dining sets in local oak: sturdy, without extra decoration.' } },
  { slug: 'lorra-milano', name: 'Lorra Milano', country: 'IT', foundedYear: 1998, isPremium: true,
    tagline: { hy: 'Իտալական ֆասադներ և կաշի', ru: 'Итальянские фасады и кожа', en: 'Italian facades and leather' },
    description: { hy: 'Ներմուծվող հավաքածուներ՝ լաքապատ ֆասադներով և բնական կաշվով։', ru: 'Импортные коллекции с лакированными фасадами и натуральной кожей.', en: 'Imported collections with lacquered facades and full-grain leather.' } },
  { slug: 'nordvik', name: 'Nordvik', country: 'SE', foundedYear: 2001, isPremium: false,
    tagline: { hy: 'Սկանդինավյան պարզություն', ru: 'Скандинавская простота', en: 'Scandinavian plainness' },
    description: { hy: 'Բաց փայտ, լակոնիկ ձևեր և ազնիվ նյութեր։', ru: 'Светлое дерево, лаконичные формы и честные материалы.', en: 'Pale wood, quiet shapes and honest materials.' } },
  { slug: 'kastel-co', name: 'Kastel & Co', country: 'PL', foundedYear: 2012, isPremium: false,
    tagline: { hy: 'Խոհանոցներ և դռներ', ru: 'Кухни и двери', en: 'Kitchens and doors' },
    description: { hy: 'Գործարանային արտադրություն՝ կայուն որակով և կարճ ժամկետներով։', ru: 'Фабричное производство со стабильным качеством и короткими сроками.', en: 'Factory production with stable quality and short lead times.' } },
  { slug: 'zangi-wood', name: 'Zangi Wood', country: 'AM', foundedYear: 2015, isPremium: false,
    tagline: { hy: 'Մանկական և պատանեկան կահույք', ru: 'Детская и подростковая мебель', en: 'Kids and teen furniture' },
    description: { hy: 'Անվտանգ ծածկույթներ, կլորացված անկյուններ, աճող մոդելներ։', ru: 'Безопасные покрытия, скруглённые углы, мебель «на вырост».', en: 'Safe finishes, rounded corners and furniture that grows.' } },
  { slug: 'arpa-home', name: 'Arpa Home', country: 'AM', foundedYear: 2018, isPremium: false,
    tagline: { hy: 'Գրասենյակային լուծումներ', ru: 'Офисные решения', en: 'Office solutions' },
    description: { hy: 'Աշխատատեղեր և պահեստավորում՝ 2–50 հոգանոց թիմերի համար։', ru: 'Рабочие места и хранение для команд от 2 до 50 человек.', en: 'Workstations and storage for teams of 2 to 50.' } },
] as const;

export const COLLECTIONS = [
  { slug: 'terra', name: 'Terra', brandSlug: 'ararat-craft' },
  { slug: 'opal', name: 'Opal', brandSlug: 'nairi-living' },
  { slug: 'linea', name: 'Linea', brandSlug: 'vayk-studio' },
  { slug: 'nova', name: 'Nova', brandSlug: 'sevan-home' },
  { slug: 'saga', name: 'Saga', brandSlug: 'nordvik' },
  { slug: 'corso', name: 'Corso', brandSlug: 'lorra-milano' },
  { slug: 'alba', name: 'Alba', brandSlug: 'orbeli-design' },
  { slug: 'vista', name: 'Vista', brandSlug: 'amberd' },
  { slug: 'dune', name: 'Dune', brandSlug: 'tavush-oak' },
  { slug: 'solis', name: 'Solis', brandSlug: 'kastel-co' },
  { slug: 'marin', name: 'Marin', brandSlug: 'zangi-wood' },
  { slug: 'atlas', name: 'Atlas', brandSlug: 'arpa-home' },
] as const;

const MODELS = [
  'ARDEN', 'NORDA', 'SEVAN', 'LUMEN', 'VERTA', 'KAMARI', 'ALTO', 'MIRA', 'TALIN', 'ARAX',
  'LORI', 'VAYK', 'AMBERD', 'SIRIA', 'NOVELLA', 'LINARA', 'TERRANO', 'OSLO', 'BERGA', 'MILANA',
  'TOSCA', 'KYOTO', 'SAKURA', 'DELTA', 'PRIMA', 'VELA', 'ARCA', 'ONYX', 'LOFTA', 'AVEN',
  'RIVA', 'SOLO', 'DUNA', 'ELIRA', 'FJORD', 'GRANA', 'HELMA', 'ISOLA', 'JUNA', 'KRONA',
  'MARENA', 'NERVA', 'ORIA', 'PALMA', 'QUARTA', 'ROSA', 'SILVA', 'TIRA', 'URBA', 'VIENNA',
];

type LeafConfig = {
  kind: ProductKind;
  price: [number, number];
  /** Width / depth / height ranges in millimetres. */
  dims: [[number, number], [number, number], [number, number]];
  colors: string[];
  materials: string[];
  styles: string[];
  room: string;
  purpose?: string;
  warranty?: number;
  skuPrefix: string;
  smallSpaceMaxWidth?: number;
};

const TEXTILE = ['chenille', 'boucle', 'velour', 'rogozhka', 'linenFabric', 'microfiber', 'ecoLeather', 'genuineLeather'];
const WOOD_BOARD = ['mdfPainted', 'chipboard', 'veneer', 'oakSolid', 'ashSolid', 'mdf'];
const SOFT_COLORS = ['beige', 'sand', 'grey', 'lightGrey', 'graphite', 'anthracite', 'emerald', 'navy', 'terracotta', 'mustard', 'olive', 'powder', 'cream'];
const CASE_COLORS = ['white', 'ivory', 'oak', 'ashWood', 'walnut', 'wenge', 'graphite', 'anthracite', 'grey', 'black', 'beige'];
const MODERN_STYLES = ['modern', 'minimal', 'scandi', 'japandi', 'loft'];
const ALL_STYLES = [...MODERN_STYLES, 'classic', 'neoclassic', 'provence', 'artdeco', 'hitech'];

/** Per-leaf generation rules. Anything not listed falls back to a case unit. */
export const LEAF_CONFIG: Record<string, LeafConfig> = {
  'straight-sofas': { kind: 'sofa', price: [189_000, 690_000], dims: [[1800, 2600], [850, 1050], [780, 950]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-STR' },
  'corner-sofas': { kind: 'sofa', price: [320_000, 980_000], dims: [[2400, 3200], [1500, 2100], [800, 950]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-COR' },
  'modular-sofas': { kind: 'sofa', price: [450_000, 1_250_000], dims: [[2600, 3600], [950, 1200], [700, 860]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-MOD' },
  'sofa-beds': { kind: 'sofa', price: [240_000, 720_000], dims: [[1900, 2400], [900, 1100], [800, 940]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-BED' },
  'two-seat-sofas': { kind: 'sofa', price: [150_000, 390_000], dims: [[1400, 1750], [800, 950], [760, 900]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-TWO', smallSpaceMaxWidth: 1750 },
  'three-seat-sofas': { kind: 'sofa', price: [210_000, 620_000], dims: [[1950, 2350], [880, 1000], [780, 920]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'SF-THR' },
  'classic-armchairs': { kind: 'armchair', price: [89_000, 320_000], dims: [[700, 950], [750, 950], [780, 1050]], colors: SOFT_COLORS, materials: TEXTILE, styles: ALL_STYLES, room: 'living', skuPrefix: 'AC-CLS', smallSpaceMaxWidth: 950 },
  'lounge-armchairs': { kind: 'armchair', price: [120_000, 430_000], dims: [[750, 1000], [800, 1000], [700, 900]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'AC-LNG', smallSpaceMaxWidth: 1000 },
  recliners: { kind: 'armchair', price: [250_000, 680_000], dims: [[850, 1000], [950, 1150], [1000, 1100]], colors: SOFT_COLORS, materials: ['ecoLeather', 'genuineLeather', 'velour', 'microfiber'], styles: MODERN_STYLES, room: 'living', skuPrefix: 'AC-REC' },
  'office-armchairs': { kind: 'armchair', price: [92_000, 290_000], dims: [[620, 720], [650, 780], [1050, 1300]], colors: ['black', 'anthracite', 'graphite', 'grey', 'navy'], materials: ['ecoLeather', 'microfiber', 'genuineLeather'], styles: ['modern', 'hitech', 'minimal'], room: 'office', purpose: 'office', skuPrefix: 'AC-OFF' },
  'chair-beds': { kind: 'armchair', price: [120_000, 265_000], dims: [[800, 1000], [900, 1050], [800, 900]], colors: SOFT_COLORS, materials: TEXTILE, styles: MODERN_STYLES, room: 'living', skuPrefix: 'AC-BED', smallSpaceMaxWidth: 1000 },
  'single-beds': { kind: 'bed', price: [118_000, 290_000], dims: [[1000, 1200], [2000, 2150], [850, 1100]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'chenille', 'velour'], styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'BD-SGL', smallSpaceMaxWidth: 1200 },
  'double-beds': { kind: 'bed', price: [198_000, 580_000], dims: [[1600, 1900], [2050, 2200], [900, 1250]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'boucle', 'velour', 'ecoLeather'], styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'BD-DBL' },
  'king-size-beds': { kind: 'bed', price: [320_000, 790_000], dims: [[1900, 2200], [2100, 2250], [950, 1350]], colors: CASE_COLORS, materials: ['velour', 'boucle', 'genuineLeather', 'oakSolid', 'veneer'], styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'BD-KNG' },
  'storage-beds': { kind: 'bed', price: [240_000, 640_000], dims: [[1600, 2000], [2050, 2200], [900, 1200]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'chenille', 'velour'], styles: MODERN_STYLES, room: 'bedroom', skuPrefix: 'BD-STO' },
  'kids-beds': { kind: 'kids', price: [110_000, 275_000], dims: [[900, 1100], [1700, 2050], [700, 1400]], colors: ['white', 'ivory', 'oak', 'ashWood', 'powder', 'blue', 'olive'], materials: ['mdfPainted', 'chipboard', 'pineSolid', 'plywood'], styles: ['scandi', 'modern', 'minimal'], room: 'kids', purpose: 'kids', skuPrefix: 'BD-KID', smallSpaceMaxWidth: 1100 },
  'pocket-spring-mattresses': { kind: 'mattress', price: [98_000, 430_000], dims: [[800, 2000], [1900, 2100], [190, 320]], colors: ['white', 'ivory'], materials: ['microfiber', 'linenFabric'], styles: ['modern'], room: 'bedroom', warranty: 60, skuPrefix: 'MT-PKT' },
  'springless-mattresses': { kind: 'mattress', price: [86_000, 340_000], dims: [[800, 1800], [1900, 2100], [160, 260]], colors: ['white', 'ivory'], materials: ['microfiber', 'linenFabric'], styles: ['modern'], room: 'bedroom', warranty: 60, skuPrefix: 'MT-SPL' },
  'orthopedic-mattresses': { kind: 'mattress', price: [125_000, 470_000], dims: [[900, 2000], [1900, 2100], [200, 340]], colors: ['white', 'ivory'], materials: ['microfiber', 'linenFabric'], styles: ['modern'], room: 'bedroom', warranty: 84, skuPrefix: 'MT-ORT' },
  'hinged-wardrobes': { kind: 'wardrobe', price: [178_000, 640_000], dims: [[900, 2400], [520, 620], [2000, 2400]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'WR-HNG' },
  'sliding-wardrobes': { kind: 'wardrobe', price: [245_000, 820_000], dims: [[1400, 2800], [600, 700], [2200, 2600]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'glass'], styles: MODERN_STYLES, room: 'bedroom', skuPrefix: 'WR-SLD' },
  'walk-in-wardrobes': { kind: 'wardrobe', price: [186_000, 580_000], dims: [[1200, 3000], [450, 600], [2100, 2500]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'metal'], styles: ['modern', 'minimal', 'loft'], room: 'bedroom', skuPrefix: 'WR-WLK' },
  dressers: { kind: 'dresser', price: [92_000, 290_000], dims: [[800, 1400], [400, 500], [750, 950]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'DR-CMD', smallSpaceMaxWidth: 900 },
  nightstands: { kind: 'nightstand', price: [34_000, 128_000], dims: [[400, 600], [350, 450], [450, 650]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: ALL_STYLES, room: 'bedroom', skuPrefix: 'NS-TMB', smallSpaceMaxWidth: 600 },
  shelving: { kind: 'shelving', price: [58_000, 268_000], dims: [[600, 1800], [300, 420], [1500, 2200]], colors: [...CASE_COLORS, 'black'], materials: [...WOOD_BOARD, 'metal', 'plywood'], styles: ['loft', 'modern', 'minimal', 'scandi'], room: 'living', skuPrefix: 'SH-STL', smallSpaceMaxWidth: 900 },
  'dining-tables': { kind: 'table', price: [128_000, 495_000], dims: [[1200, 2200], [800, 1100], [740, 790]], colors: ['oak', 'ashWood', 'walnut', 'white', 'black', 'graphite', 'wenge'], materials: ['oakSolid', 'ashSolid', 'veneer', 'ceramic', 'quartz', 'mdfPainted', 'glass'], styles: ALL_STYLES, room: 'dining', skuPrefix: 'TB-DIN' },
  'coffee-tables': { kind: 'table', price: [58_000, 235_000], dims: [[700, 1300], [500, 800], [380, 480]], colors: ['oak', 'walnut', 'black', 'white', 'marble' in COLORS ? 'white' : 'white', 'graphite'], materials: ['oakSolid', 'veneer', 'marble', 'glass', 'metal', 'mdfPainted'], styles: ALL_STYLES, room: 'living', skuPrefix: 'TB-CFF', smallSpaceMaxWidth: 900 },
  'writing-desks': { kind: 'desk', price: [78_000, 265_000], dims: [[1000, 1600], [550, 750], [740, 780]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'metal'], styles: MODERN_STYLES, room: 'office', skuPrefix: 'TB-WRT', smallSpaceMaxWidth: 1200 },
  'computer-desks': { kind: 'desk', price: [68_000, 228_000], dims: [[1100, 1600], [600, 800], [740, 1200]], colors: ['white', 'black', 'graphite', 'oak', 'anthracite'], materials: [...WOOD_BOARD, 'metal', 'hpl'], styles: ['modern', 'hitech', 'minimal', 'loft'], room: 'office', skuPrefix: 'TB-CMP' },
  'folding-tables': { kind: 'table', price: [62_000, 189_000], dims: [[900, 1400], [600, 850], [740, 780]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'glass'], styles: MODERN_STYLES, room: 'dining', skuPrefix: 'TB-FLD', smallSpaceMaxWidth: 1000 },
  'office-tables': { kind: 'desk', price: [94_000, 310_000], dims: [[1200, 2400], [700, 900], [740, 760]], colors: ['white', 'graphite', 'oak', 'anthracite', 'black'], materials: [...WOOD_BOARD, 'metal', 'hpl'], styles: ['modern', 'minimal', 'hitech'], room: 'office', purpose: 'office', skuPrefix: 'TB-OFF' },
  'kitchen-chairs': { kind: 'chair', price: [24_000, 74_000], dims: [[420, 500], [480, 560], [820, 950]], colors: [...CASE_COLORS, 'emerald', 'navy', 'terracotta'], materials: ['beechSolid', 'metal', 'plastic', 'plywood', 'chenille'], styles: ALL_STYLES, room: 'kitchen', skuPrefix: 'CH-KIT' },
  'dining-chairs': { kind: 'chair', price: [36_000, 118_000], dims: [[440, 560], [500, 620], [850, 1000]], colors: SOFT_COLORS, materials: ['oakSolid', 'beechSolid', 'velour', 'boucle', 'ecoLeather', 'metal'], styles: ALL_STYLES, room: 'dining', skuPrefix: 'CH-DIN' },
  'bar-stools': { kind: 'chair', price: [42_000, 128_000], dims: [[400, 500], [420, 520], [950, 1150]], colors: SOFT_COLORS, materials: ['metal', 'ecoLeather', 'velour', 'plywood', 'plastic'], styles: ['loft', 'modern', 'hitech', 'minimal'], room: 'kitchen', skuPrefix: 'CH-BAR' },
  'office-chairs': { kind: 'chair', price: [46_000, 168_000], dims: [[550, 680], [560, 700], [900, 1250]], colors: ['black', 'grey', 'anthracite', 'navy', 'graphite'], materials: ['microfiber', 'ecoLeather', 'metal', 'plastic'], styles: ['modern', 'hitech'], room: 'office', purpose: 'office', skuPrefix: 'CH-OFF' },
  'designer-chairs': { kind: 'chair', price: [64_000, 235_000], dims: [[480, 620], [520, 650], [740, 900]], colors: SOFT_COLORS, materials: ['plywood', 'plastic', 'boucle', 'genuineLeather', 'rattan', 'metal'], styles: ['artdeco', 'japandi', 'scandi', 'modern'], room: 'dining', skuPrefix: 'CH-DSG' },
  'ready-kitchens': { kind: 'kitchen', price: [860_000, 3_200_000], dims: [[2400, 4200], [600, 640], [2150, 2400]], colors: CASE_COLORS, materials: ['mdfPainted', 'chipboard', 'veneer', 'hpl'], styles: ALL_STYLES, room: 'kitchen', skuPrefix: 'KT-RDY' },
  'modular-kitchens': { kind: 'kitchen', price: [640_000, 2_400_000], dims: [[1800, 3600], [600, 640], [2100, 2350]], colors: CASE_COLORS, materials: ['mdfPainted', 'chipboard', 'hpl'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-MOD' },
  'upper-cabinets': { kind: 'kitchen', price: [44_000, 124_000], dims: [[400, 900], [320, 360], [600, 900]], colors: CASE_COLORS, materials: ['mdfPainted', 'chipboard'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-UPR' },
  'lower-cabinets': { kind: 'kitchen', price: [58_000, 168_000], dims: [[400, 900], [560, 600], [820, 880]], colors: CASE_COLORS, materials: ['mdfPainted', 'chipboard'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-LWR' },
  'tall-cabinets': { kind: 'kitchen', price: [124_000, 296_000], dims: [[500, 700], [560, 600], [2100, 2350]], colors: CASE_COLORS, materials: ['mdfPainted', 'chipboard', 'hpl'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-TAL' },
  'kitchen-islands': { kind: 'kitchen', price: [285_000, 760_000], dims: [[1200, 2200], [800, 1100], [880, 920]], colors: CASE_COLORS, materials: ['mdfPainted', 'quartz', 'oakSolid', 'hpl'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-ISL' },
  countertops: { kind: 'countertop', price: [62_000, 268_000], dims: [[1800, 4000], [600, 900], [20, 60]], colors: ['white', 'black', 'graphite', 'oak', 'beige', 'anthracite'], materials: ['quartz', 'ceramic', 'marble', 'hpl', 'oakSolid'], styles: MODERN_STYLES, room: 'kitchen', skuPrefix: 'KT-CTP' },
  'shoe-racks': { kind: 'hallway', price: [44_000, 145_000], dims: [[600, 1200], [250, 350], [500, 1200]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: MODERN_STYLES, room: 'hallway', skuPrefix: 'HL-SHO', smallSpaceMaxWidth: 900 },
  'coat-racks': { kind: 'hallway', price: [24_000, 96_000], dims: [[400, 900], [300, 420], [1600, 1900]], colors: [...CASE_COLORS, 'black'], materials: ['metal', 'oakSolid', 'beechSolid', 'mdfPainted'], styles: MODERN_STYLES, room: 'hallway', skuPrefix: 'HL-CTR', smallSpaceMaxWidth: 900 },
  'hallway-cabinets': { kind: 'hallway', price: [124_000, 335_000], dims: [[900, 1800], [300, 400], [2000, 2300]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: MODERN_STYLES, room: 'hallway', skuPrefix: 'HL-CAB' },
  'mirror-sets': { kind: 'hallway', price: [56_000, 186_000], dims: [[500, 900], [40, 120], [1400, 1900]], colors: CASE_COLORS, materials: ['glass', 'mdfPainted', 'oakSolid', 'metal'], styles: ALL_STYLES, room: 'hallway', skuPrefix: 'HL-MIR', smallSpaceMaxWidth: 900 },
  kids: { kind: 'kids', price: [82_000, 330_000], dims: [[600, 1600], [400, 600], [800, 2000]], colors: ['white', 'ivory', 'oak', 'powder', 'blue', 'olive', 'mustard'], materials: ['mdfPainted', 'chipboard', 'pineSolid', 'plywood'], styles: ['scandi', 'modern', 'minimal', 'provence'], room: 'kids', purpose: 'kids', skuPrefix: 'KD-GEN' },
  office: { kind: 'office', price: [94_000, 430_000], dims: [[800, 2000], [400, 800], [700, 2000]], colors: ['white', 'graphite', 'oak', 'anthracite', 'black', 'ashWood'], materials: [...WOOD_BOARD, 'metal', 'hpl'], styles: ['modern', 'minimal', 'hitech', 'loft'], room: 'office', purpose: 'office', skuPrefix: 'OF-GEN' },
  'tv-stands': { kind: 'living', price: [72_000, 288_000], dims: [[1200, 2200], [350, 450], [350, 550]], colors: CASE_COLORS, materials: [...WOOD_BOARD, 'glass', 'metal'], styles: MODERN_STYLES, room: 'living', skuPrefix: 'LV-TVS' },
  'wall-systems': { kind: 'living', price: [225_000, 740_000], dims: [[2000, 3600], [380, 480], [1800, 2400]], colors: CASE_COLORS, materials: WOOD_BOARD, styles: ALL_STYLES, room: 'living', skuPrefix: 'LV-WLS' },
  'interior-doors': { kind: 'door', price: [56_000, 225_000], dims: [[600, 900], [36, 45], [2000, 2100]], colors: ['white', 'ivory', 'oak', 'ashWood', 'walnut', 'wenge', 'graphite', 'anthracite'], materials: ['mdf', 'veneer', 'mdfPainted', 'hpl'], styles: ALL_STYLES, room: 'living', warranty: 36, skuPrefix: 'DR-INT' },
  'entrance-doors': { kind: 'door', price: [186_000, 680_000], dims: [[860, 1000], [70, 110], [2050, 2150]], colors: ['anthracite', 'graphite', 'walnut', 'wenge', 'black', 'brown'], materials: ['steel', 'mdf', 'veneer'], styles: ['modern', 'classic', 'hitech'], room: 'hallway', warranty: 60, skuPrefix: 'DR-ENT' },
  'sliding-doors': { kind: 'door', price: [92_000, 285_000], dims: [[700, 1000], [36, 40], [2000, 2400]], colors: ['white', 'oak', 'ashWood', 'graphite', 'black'], materials: ['mdf', 'veneer', 'glass', 'metal'], styles: MODERN_STYLES, room: 'living', warranty: 36, skuPrefix: 'DR-SLD' },
  'hidden-doors': { kind: 'door', price: [142_000, 365_000], dims: [[700, 900], [40, 48], [2000, 2400]], colors: ['white', 'ivory', 'graphite', 'black'], materials: ['mdf', 'mdfPainted', 'metal'], styles: ['minimal', 'modern'], room: 'living', warranty: 36, skuPrefix: 'DR-HID' },
  'glass-doors': { kind: 'door', price: [124_000, 325_000], dims: [[700, 900], [8, 12], [2000, 2100]], colors: ['white', 'graphite', 'black', 'grey'], materials: ['glass', 'metal'], styles: ['modern', 'loft', 'hitech'], room: 'living', warranty: 36, skuPrefix: 'DR-GLS' },
  'classic-doors': { kind: 'door', price: [92_000, 268_000], dims: [[600, 900], [38, 45], [2000, 2100]], colors: ['ivory', 'walnut', 'wenge', 'oak', 'white'], materials: ['mdf', 'veneer', 'oakSolid'], styles: ['classic', 'neoclassic', 'provence'], room: 'living', warranty: 36, skuPrefix: 'DR-CLS' },
  'modern-doors': { kind: 'door', price: [72_000, 245_000], dims: [[600, 900], [36, 42], [2000, 2200]], colors: ['white', 'graphite', 'oak', 'anthracite', 'black'], materials: ['mdf', 'mdfPainted', 'hpl'], styles: MODERN_STYLES, room: 'living', warranty: 36, skuPrefix: 'DR-MOD' },
};

const FALLBACK: LeafConfig = {
  kind: 'living',
  price: [80_000, 320_000],
  dims: [[600, 1600], [380, 600], [700, 1800]],
  colors: CASE_COLORS,
  materials: WOOD_BOARD,
  styles: MODERN_STYLES,
  room: 'living',
  skuPrefix: 'GN-MSC',
};

export type GeneratedProduct = {
  sku: string;
  slug: string;
  categorySlug: string;
  rootSlug: string;
  brandSlug: string;
  collectionSlug: string | null;
  artKey: string;
  kind: ProductKind;
  priceMinor: number;
  oldPriceMinor: number | null;
  discountPct: number;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  stockQty: number;
  productionDays: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  weightGram: number;
  country: string;
  warrantyMonths: number;
  styleKey: string;
  purposeKey: string;
  roomKey: string;
  colorKeys: string[];
  materialKeys: string[];
  specs: Record<string, string | number | boolean>;
  ratingAvg: number;
  reviewCount: number;
  salesCount: number;
  isNew: boolean;
  isHit: boolean;
  isPremium: boolean;
  isFeatured: boolean;
  smallSpace: boolean;
  model: string;
  images: { url: string; sort: number; isPrimary: boolean }[];
  options: { kind: 'COLOR' | 'MATERIAL' | 'SIZE'; valueKey: string; label: string | null; priceDeltaMinor: number; isDefault: boolean; sort: number }[];
  translations: { locale: 'hy' | 'ru' | 'en'; name: string; shortDescription: string; description: string }[];
  searchText: string;
};

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
const between = (rng: () => number, min: number, max: number): number =>
  Math.round(min + rng() * (max - min));

/** Retail-looking price: rounded to the nearest 1 000 dram, ending in 900. */
const retailPrice = (value: number): number => Math.max(900, Math.round(value / 1000) * 1000 - 100);

const fillTemplate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

const MATTRESS_SIZES = ['800 × 1900', '900 × 2000', '1200 × 2000', '1400 × 2000', '1600 × 2000', '1800 × 2000', '2000 × 2000'];
const DOOR_SIZES = ['600 × 2000', '700 × 2000', '800 × 2000', '900 × 2000', '800 × 2100'];

const buildSpecs = (
  config: LeafConfig,
  rng: () => number,
  dims: { widthMm: number; depthMm: number; heightMm: number },
  material: string,
  leafSlug: string,
): Record<string, string | number | boolean> => {
  const specs: Record<string, string | number | boolean> = {};
  switch (config.kind) {
    case 'sofa': {
      specs.mechanism = leafSlug === 'modular-sofas' ? 'none' : pick(rng, ['eurobook', 'dolphin', 'accordion', 'clickclack', 'rollout']);
      if (specs.mechanism !== 'none')
        specs.sleepingArea = `${between(rng, 1300, 1600)} × ${between(rng, 1900, 2050)} мм`;
      specs.fabricType = material;
      specs.filler = pick(rng, ['hrFoam', 'pocketSpring', 'holofiber', 'springBonnell']);
      specs.seats = leafSlug === 'two-seat-sofas' ? 2 : leafSlug === 'three-seat-sofas' ? 3 : between(rng, 2, 5);
      specs.removableCovers = rng() > 0.35;
      if (leafSlug === 'corner-sofas') specs.cornerSide = pick(rng, ['left', 'right', 'universal']);
      break;
    }
    case 'armchair': {
      specs.filler = pick(rng, ['hrFoam', 'holofiber', 'latex']);
      specs.seatHeight = `${between(rng, 420, 500)} мм`;
      specs.maxLoad = `${pick(rng, [110, 120, 130, 150])} кг`;
      specs.armrests = true;
      specs.upholsteryMaterial = material;
      break;
    }
    case 'bed': {
      specs.mattressSize = `${dims.widthMm - between(rng, 80, 140)} × ${dims.depthMm - between(rng, 60, 120)} мм`;
      specs.liftMechanism = leafSlug === 'storage-beds' ? true : rng() > 0.6;
      specs.linenBox = specs.liftMechanism === true ? true : rng() > 0.55;
      specs.baseType = pick(rng, ['slats', 'slats', 'solid']);
      specs.headboard = pick(rng, ['upholstered', 'wooden', 'upholstered']);
      break;
    }
    case 'mattress': {
      specs.springType = leafSlug === 'springless-mattresses' ? 'springless' : pick(rng, ['pocket', 'pocket', 'bonnell']);
      specs.rigidity = pick(rng, ['soft', 'medium', 'medium', 'firm']);
      specs.mattressSize = `${pick(rng, MATTRESS_SIZES)} мм`;
      specs.filler = pick(rng, ['pocketSpring', 'latex', 'memoryFoam', 'hrFoam']);
      specs.maxLoadPerSleeper = `${pick(rng, [100, 110, 120, 140, 160])} кг`;
      break;
    }
    case 'wardrobe': {
      specs.doorsCount = leafSlug === 'sliding-wardrobes' ? between(rng, 2, 3) : between(rng, 2, 5);
      specs.mirror = rng() > 0.45;
      specs.shelvesCount = between(rng, 4, 12);
      specs.drawersCount = between(rng, 0, 4);
      specs.madeToMeasure = rng() > 0.4;
      break;
    }
    case 'dresser':
      specs.drawersCount = between(rng, 3, 6);
      specs.hardware = pick(rng, ['soft', 'soft', 'basic']);
      break;
    case 'nightstand':
      specs.drawersCount = between(rng, 1, 3);
      specs.shelvesCount = between(rng, 0, 1);
      break;
    case 'shelving':
      specs.shelvesCount = between(rng, 3, 7);
      specs.maxLoad = `${pick(rng, [15, 20, 25, 30])} кг на полку`;
      break;
    case 'table': {
      specs.tableShape = pick(rng, ['rectangular', 'rectangular', 'round', 'oval', 'square']);
      specs.extendable = leafSlug === 'folding-tables' ? true : rng() > 0.7;
      specs.topMaterial = material;
      specs.seatsCount = Math.max(2, Math.round(dims.widthMm / 600));
      break;
    }
    case 'desk':
      specs.topMaterial = material;
      specs.cableManagement = rng() > 0.35;
      specs.drawersCount = between(rng, 0, 3);
      specs.adjustableHeight = rng() > 0.78;
      break;
    case 'chair':
      specs.frameMaterial = pick(rng, ['metal', 'beechSolid', 'oakSolid', 'plastic']);
      specs.upholsteryMaterial = material;
      specs.maxLoad = `${pick(rng, [100, 110, 120, 130, 150])} кг`;
      specs.seatHeight = `${leafSlug === 'bar-stools' ? between(rng, 650, 780) : between(rng, 440, 480)} мм`;
      specs.stackable = rng() > 0.7;
      break;
    case 'kitchen':
      specs.kitchenLength = `${(dims.widthMm / 1000).toFixed(1)} м`;
      specs.facadeType = pick(rng, ['matteLacquer', 'glossLacquer', 'veneer', 'plasticHpl', 'frameMdf']);
      specs.bodyMaterial = pick(rng, ['chipboard', 'mdf']);
      specs.countertopMaterial = pick(rng, ['quartz', 'hpl', 'ceramic', 'oakSolid']);
      specs.configuration = pick(rng, ['straight', 'lShaped', 'uShaped', 'island']);
      specs.madeToMeasure = true;
      specs.builtInAppliances = rng() > 0.5;
      break;
    case 'countertop':
      specs.countertopMaterial = material;
      specs.doorThickness = `${dims.heightMm} мм`;
      specs.madeToMeasure = true;
      break;
    case 'hallway':
      specs.shelvesCount = between(rng, 1, 5);
      specs.mirror = leafSlug === 'mirror-sets' ? true : rng() > 0.6;
      break;
    case 'kids':
      specs.ageGroup = pick(rng, ['toddler', 'child', 'teen']);
      specs.adjustableHeight = rng() > 0.6;
      specs.assemblyRequired = true;
      break;
    case 'office':
      specs.adjustableHeight = rng() > 0.5;
      specs.cableManagement = rng() > 0.4;
      specs.drawersCount = between(rng, 0, 4);
      specs.maxLoad = `${pick(rng, [40, 60, 80])} кг`;
      break;
    case 'living':
      specs.cableManagement = rng() > 0.3;
      specs.drawersCount = between(rng, 1, 4);
      specs.shelvesCount = between(rng, 1, 6);
      break;
    case 'door': {
      const size = pick(rng, DOOR_SIZES).split(' × ');
      specs.doorWidth = `${size[0]} мм`;
      specs.doorHeight = `${size[1]} мм`;
      specs.doorThickness = `${dims.depthMm} мм`;
      specs.coating = pick(rng, ['enamel', 'veneer', 'ecoVeneer', 'pvc', 'laminate']);
      specs.openingType =
        leafSlug === 'sliding-doors' ? 'sliding' : leafSlug === 'hidden-doors' ? 'hidden' : 'swing';
      specs.openingSide = pick(rng, ['left', 'right', 'universal']);
      specs.frameIncluded = rng() > 0.4;
      specs.casingIncluded = rng() > 0.5;
      specs.hardware = pick(rng, ['basic', 'soft', 'premium']);
      specs.installationPrice = '25 000 ֏';
      if (leafSlug === 'entrance-doors') {
        specs.soundInsulation = `${pick(rng, [32, 34, 36, 42])} дБ`;
        specs.lockClass = pick(rng, ['3', '4']);
      }
      break;
    }
  }
  return specs;
};

const COUNTRY_NAMES: Record<string, { hy: string; ru: string; en: string }> = {
  AM: { hy: 'Հայաստան', ru: 'Армения', en: 'Armenia' },
  IT: { hy: 'Իտալիա', ru: 'Италия', en: 'Italy' },
  SE: { hy: 'Շվեդիա', ru: 'Швеция', en: 'Sweden' },
  PL: { hy: 'Լեհաստան', ru: 'Польша', en: 'Poland' },
};

export const generateProducts = (): GeneratedProduct[] => {
  const products: GeneratedProduct[] = [];
  let globalIndex = 0;

  for (const { node, rootSlug } of productLeaves()) {
    const count = node.productCount ?? 0;
    const config = LEAF_CONFIG[node.slug] ?? FALLBACK;

    for (let i = 0; i < count; i += 1) {
      globalIndex += 1;
      const rng = createRng(globalIndex * 2654435761);
      const model = MODELS[(globalIndex * 7 + i * 3) % MODELS.length]!;
      const brand = BRANDS[Math.floor(rng() * BRANDS.length)]!;
      const brandCollections = COLLECTIONS.filter((collection) => collection.brandSlug === brand.slug);
      const collection = brandCollections.length > 0 && rng() > 0.25 ? brandCollections[0]! : null;

      const colorKey = pick(rng, config.colors);
      const materialKey = pick(rng, config.materials);
      const styleKey = pick(rng, config.styles);

      const widthMm = between(rng, config.dims[0][0], config.dims[0][1]);
      const depthMm = between(rng, config.dims[1][0], config.dims[1][1]);
      const heightMm = between(rng, config.dims[2][0], config.dims[2][1]);

      const basePrice = retailPrice(between(rng, config.price[0], config.price[1]));
      const hasDiscount = rng() > 0.66;
      const discountPct = hasDiscount ? pick(rng, [5, 10, 12, 15, 18, 20, 25, 30]) : 0;
      const oldPriceMinor = hasDiscount ? retailPrice(Math.round(basePrice / (1 - discountPct / 100))) : null;

      const stockRoll = rng();
      const stockStatus = stockRoll > 0.42 ? 'IN_STOCK' : stockRoll > 0.1 ? 'ON_ORDER' : 'OUT_OF_STOCK';
      const stockQty = stockStatus === 'IN_STOCK' ? between(rng, 1, 24) : 0;
      const productionDays = stockStatus === 'IN_STOCK' ? 0 : between(rng, 7, 45);

      const ratingAvg = Number((3.6 + rng() * 1.4).toFixed(1));
      const reviewCount = Math.floor(rng() * 48);

      // Colour / material / size option sets with price deltas.
      const extraColors = [...new Set([colorKey, ...Array.from({ length: 3 }, () => pick(rng, config.colors))])].slice(0, 4);
      const extraMaterials = [...new Set([materialKey, ...Array.from({ length: 2 }, () => pick(rng, config.materials))])].slice(0, 3);
      const options: GeneratedProduct['options'] = [];
      extraColors.forEach((key, index) => {
        options.push({
          kind: 'COLOR',
          valueKey: key,
          label: null,
          priceDeltaMinor: index === 0 ? 0 : retailPrice(Math.round(basePrice * (0.02 + rng() * 0.05))) - 900,
          isDefault: index === 0,
          sort: index,
        });
      });
      if (config.kind !== 'mattress' && config.kind !== 'countertop') {
        extraMaterials.forEach((key, index) => {
          options.push({
            kind: 'MATERIAL',
            valueKey: key,
            label: null,
            priceDeltaMinor: index === 0 ? 0 : retailPrice(Math.round(basePrice * (0.04 + rng() * 0.08))) - 900,
            isDefault: index === 0,
            sort: index,
          });
        });
      }
      const sizeValues =
        config.kind === 'mattress'
          ? MATTRESS_SIZES.slice(1, 5)
          : config.kind === 'door'
            ? DOOR_SIZES.slice(0, 4)
            : config.kind === 'bed'
              ? ['1400 × 2000', '1600 × 2000', '1800 × 2000']
              : [];
      sizeValues.forEach((value, index) => {
        options.push({
          kind: 'SIZE',
          valueKey: value.replace(/\s|×/g, '').toLowerCase(),
          label: `${value} мм`,
          priceDeltaMinor: index === 0 ? 0 : retailPrice(Math.round(basePrice * 0.06 * index)) - 900,
          isDefault: index === 0,
          sort: index,
        });
      });

      const specs = buildSpecs(config, rng, { widthMm, depthMm, heightMm }, materialKey, node.slug);

      const sku = `${config.skuPrefix}-${String(globalIndex).padStart(4, '0')}`;
      const slug = slugify(`${TYPE_NAMES[node.slug]?.en ?? node.slug}-${model}-${sku}`);
      const images: GeneratedProduct['images'] = ([0, 1, 2, 3] as ArtVariant[]).map((variant) => ({
        url: artworkUrl(node.artKey, colorKey, variant, globalIndex),
        sort: variant,
        isPrimary: variant === 0,
      }));

      const translations = (['hy', 'ru', 'en'] as const).map((locale) => {
        const typeName = TYPE_NAMES[node.slug]?.[locale] ?? node.names[locale];
        const colorLabel = COLORS[colorKey]?.label[locale] ?? colorKey;
        const materialLabel = MATERIALS[materialKey]?.label[locale] ?? materialKey;
        const values = {
          model,
          material: materialLabel,
          color: colorLabel.toLowerCase(),
          width: Math.round(widthMm / 10),
          depth: Math.round(depthMm / 10),
          height: Math.round(heightMm / 10),
          warranty: config.warranty ?? (brand.isPremium ? 36 : 24),
          country: COUNTRY_NAMES[brand.country]?.[locale] ?? brand.country,
        };
        const intros = KIND_INTRO[config.kind];
        const intro = fillTemplate(intros[globalIndex % intros.length]![locale], values);
        const body = fillTemplate(BODY_TEMPLATES[(globalIndex + i) % BODY_TEMPLATES.length]![locale], values);
        const closing = KIND_CLOSING[config.kind][locale];
        const short = fillTemplate(SHORT_TEMPLATES[globalIndex % SHORT_TEMPLATES.length]![locale], values);
        return {
          locale,
          name: `${typeName} ${model}, ${materialLabel.toLowerCase()}, ${colorLabel.toLowerCase()}`,
          shortDescription: short,
          description: `${intro} ${body} ${closing}`,
        };
      });

      const searchText = [
        sku,
        model,
        brand.name,
        collection?.name ?? '',
        ...translations.map((translation) => translation.name),
        ...[colorKey, ...extraColors].map((key) => Object.values(COLORS[key]?.label ?? {}).join(' ')),
        ...[materialKey, ...extraMaterials].map((key) => Object.values(MATERIALS[key]?.label ?? {}).join(' ')),
        styleKey,
        node.slug,
        rootSlug,
      ]
        .join(' ')
        .toLowerCase();

      products.push({
        sku,
        slug,
        categorySlug: node.slug,
        rootSlug,
        brandSlug: brand.slug,
        collectionSlug: collection?.slug ?? null,
        artKey: node.artKey,
        kind: config.kind,
        priceMinor: basePrice,
        oldPriceMinor,
        discountPct,
        stockStatus,
        stockQty,
        productionDays,
        widthMm,
        heightMm,
        depthMm,
        weightGram: between(rng, 6, 120) * 1000,
        country: brand.country,
        warrantyMonths: config.warranty ?? (brand.isPremium ? 36 : 24),
        styleKey,
        purposeKey: config.purpose ?? 'home',
        roomKey: config.room,
        colorKeys: extraColors,
        materialKeys: extraMaterials,
        specs,
        ratingAvg,
        reviewCount,
        salesCount: Math.floor(rng() * 180),
        isNew: rng() > 0.78,
        isHit: rng() > 0.82,
        isPremium: brand.isPremium && rng() > 0.35,
        isFeatured: rng() > 0.74,
        smallSpace: config.smallSpaceMaxWidth !== undefined && widthMm <= config.smallSpaceMaxWidth,
        model,
        images,
        options,
        translations,
        searchText,
      });
    }
  }

  return products;
};
