/** Static demo content: banners, promo codes and the door configurator catalogue. */

export const BANNERS = [
  {
    key: 'hero-spring',
    position: 'HOME_HERO' as const,
    artKey: 'sofa',
    href: '/catalog/sofas',
    sort: 0,
    translations: {
      hy: { eyebrow: 'Նոր հավաքածու', title: 'Հյուրասենյակ, որտեղ ուզում ես մնալ', subtitle: 'Բազմոցներ և բազկաթոռներ՝ մինչև 30% զեղչով, առաքումը՝ 2 օրում', ctaLabel: 'Դիտել բազմոցները' },
      ru: { eyebrow: 'Новая коллекция', title: 'Гостиная, из которой не хочется уходить', subtitle: 'Диваны и кресла со скидкой до 30%, доставка за 2 дня', ctaLabel: 'Смотреть диваны' },
      en: { eyebrow: 'New collection', title: 'A living room you will not want to leave', subtitle: 'Sofas and armchairs up to 30% off, delivered in two days', ctaLabel: 'Shop sofas' },
    },
  },
  {
    key: 'hero-kitchen',
    position: 'HOME_HERO' as const,
    artKey: 'kitchen',
    href: '/kitchens',
    sort: 1,
    translations: {
      hy: { eyebrow: 'Խոհանոցներ պատվերով', title: 'Խոհանոց ձեր չափսերով՝ 30 օրում', subtitle: 'Անվճար չափագրում Երևանում և 3 հատակագիծ մեկ օրում', ctaLabel: 'Հաշվարկել խոհանոցը' },
      ru: { eyebrow: 'Кухни на заказ', title: 'Кухня по вашим размерам за 30 дней', subtitle: 'Бесплатный замер по Еревану и 3 варианта планировки за день', ctaLabel: 'Рассчитать кухню' },
      en: { eyebrow: 'Made-to-measure kitchens', title: 'A kitchen built to your millimetres in 30 days', subtitle: 'Free measurement in Yerevan and three layouts within a day', ctaLabel: 'Plan my kitchen' },
    },
  },
  {
    key: 'hero-doors',
    position: 'HOME_HERO' as const,
    artKey: 'door',
    href: '/catalog/doors',
    sort: 2,
    translations: {
      hy: { eyebrow: 'Դռներ տեղադրմամբ', title: 'Դուռ՝ շրջանակով, ֆուռնիտուրայով և տեղադրմամբ', subtitle: 'Հավաքեք կոմպլեկտը կոնֆիգուրատորում՝ գինը կտեսնեք միանգամից', ctaLabel: 'Հավաքել դուռը' },
      ru: { eyebrow: 'Двери с установкой', title: 'Дверь с коробкой, фурнитурой и монтажом', subtitle: 'Соберите комплект в конфигураторе — цену увидите сразу', ctaLabel: 'Собрать дверь' },
      en: { eyebrow: 'Doors with installation', title: 'A door with the frame, hardware and fitting', subtitle: 'Build the set in the configurator and see the price instantly', ctaLabel: 'Configure a door' },
    },
  },
  {
    key: 'strip-delivery',
    position: 'HOME_STRIP' as const,
    artKey: 'shelving',
    href: '/delivery',
    sort: 0,
    translations: {
      hy: { eyebrow: '', title: 'Անվճար առաքում 400 000 ֏-ից', subtitle: 'Ամբողջ Հայաստանում՝ հարկ բարձրացնելու հնարավորությամբ', ctaLabel: 'Առաքման պայմանները' },
      ru: { eyebrow: '', title: 'Бесплатная доставка от 400 000 ֏', subtitle: 'По всей Армении, с возможностью подъёма на этаж', ctaLabel: 'Условия доставки' },
      en: { eyebrow: '', title: 'Free delivery over 400 000 ֏', subtitle: 'Anywhere in Armenia, with carry-up available', ctaLabel: 'Delivery terms' },
    },
  },
];

export const PROMO_CODES = [
  {
    code: 'WELCOME10',
    discountType: 'PERCENT' as const,
    value: 10,
    minSubtotalMinor: 100_000,
    maxDiscountMinor: 120_000,
    freeDelivery: false,
    usageLimit: null,
    description: 'Скидка 10% на первый заказ от 100 000 ֏ (максимум 120 000 ֏)',
  },
  {
    code: 'SOFA50',
    discountType: 'FIXED' as const,
    value: 50_000,
    minSubtotalMinor: 300_000,
    maxDiscountMinor: null,
    freeDelivery: false,
    usageLimit: 500,
    description: 'Минус 50 000 ֏ при заказе от 300 000 ֏',
  },
  {
    code: 'FREEDELIVERY',
    discountType: 'FIXED' as const,
    value: 0,
    minSubtotalMinor: 50_000,
    maxDiscountMinor: null,
    freeDelivery: true,
    usageLimit: null,
    description: 'Бесплатная доставка по Армении от 50 000 ֏',
  },
  {
    code: 'DEMO25',
    discountType: 'PERCENT' as const,
    value: 25,
    minSubtotalMinor: null,
    maxDiscountMinor: 200_000,
    freeDelivery: true,
    usageLimit: null,
    description: 'Демонстрационный промокод: −25% и бесплатная доставка',
  },
  {
    code: 'EXPIRED',
    discountType: 'PERCENT' as const,
    value: 30,
    minSubtotalMinor: null,
    maxDiscountMinor: null,
    freeDelivery: false,
    usageLimit: null,
    description: 'Истёкший промокод — нужен, чтобы показать обработку ошибки',
    expired: true,
  },
];

type DoorOptionSeed = {
  groupKey: string;
  optionKey: string;
  priceMinor: number;
  sort: number;
  labels: { hy: string; ru: string; en: string };
};

/**
 * Door configurator catalogue. Prices are deltas on top of the door leaf and
 * are applied server-side — see src/lib/pricing/door.ts.
 */
export const DOOR_OPTIONS: DoorOptionSeed[] = [
  { groupKey: 'size', optionKey: '600x2000', priceMinor: 0, sort: 0, labels: { hy: '600 × 2000 մմ', ru: '600 × 2000 мм', en: '600 × 2000 mm' } },
  { groupKey: 'size', optionKey: '700x2000', priceMinor: 4_000, sort: 1, labels: { hy: '700 × 2000 մմ', ru: '700 × 2000 мм', en: '700 × 2000 mm' } },
  { groupKey: 'size', optionKey: '800x2000', priceMinor: 8_000, sort: 2, labels: { hy: '800 × 2000 մմ', ru: '800 × 2000 мм', en: '800 × 2000 mm' } },
  { groupKey: 'size', optionKey: '900x2000', priceMinor: 14_000, sort: 3, labels: { hy: '900 × 2000 մմ', ru: '900 × 2000 мм', en: '900 × 2000 mm' } },
  { groupKey: 'size', optionKey: '800x2100', priceMinor: 18_000, sort: 4, labels: { hy: '800 × 2100 մմ', ru: '800 × 2100 мм', en: '800 × 2100 mm' } },

  { groupKey: 'coating', optionKey: 'laminate', priceMinor: 0, sort: 0, labels: { hy: 'Լամինատ', ru: 'Ламинат', en: 'Laminate' } },
  { groupKey: 'coating', optionKey: 'ecoVeneer', priceMinor: 12_000, sort: 1, labels: { hy: 'Էկո-սպոն', ru: 'Экошпон', en: 'Eco-veneer' } },
  { groupKey: 'coating', optionKey: 'enamel', priceMinor: 26_000, sort: 2, labels: { hy: 'Էմալ', ru: 'Эмаль', en: 'Enamel' } },
  { groupKey: 'coating', optionKey: 'veneer', priceMinor: 42_000, sort: 3, labels: { hy: 'Բնական սպոն', ru: 'Натуральный шпон', en: 'Natural veneer' } },

  { groupKey: 'color', optionKey: 'white', priceMinor: 0, sort: 0, labels: { hy: 'Սպիտակ', ru: 'Белый', en: 'White' } },
  { groupKey: 'color', optionKey: 'ivory', priceMinor: 0, sort: 1, labels: { hy: 'Փղոսկր', ru: 'Слоновая кость', en: 'Ivory' } },
  { groupKey: 'color', optionKey: 'oak', priceMinor: 6_000, sort: 2, labels: { hy: 'Կաղնի', ru: 'Дуб', en: 'Oak' } },
  { groupKey: 'color', optionKey: 'walnut', priceMinor: 6_000, sort: 3, labels: { hy: 'Ընկուզենի', ru: 'Орех', en: 'Walnut' } },
  { groupKey: 'color', optionKey: 'graphite', priceMinor: 9_000, sort: 4, labels: { hy: 'Գրաֆիտ', ru: 'Графит', en: 'Graphite' } },

  { groupKey: 'frame', optionKey: 'none', priceMinor: 0, sort: 0, labels: { hy: 'Առանց շրջանակի', ru: 'Без коробки', en: 'No frame' } },
  { groupKey: 'frame', optionKey: 'standard', priceMinor: 18_000, sort: 1, labels: { hy: 'Ստանդարտ շրջանակ', ru: 'Стандартная коробка', en: 'Standard frame' } },
  { groupKey: 'frame', optionKey: 'telescopic', priceMinor: 28_000, sort: 2, labels: { hy: 'Հեռադիտակային շրջանակ', ru: 'Телескопическая коробка', en: 'Telescopic frame' } },

  { groupKey: 'casing', optionKey: 'none', priceMinor: 0, sort: 0, labels: { hy: 'Առանց նալիչնիկների', ru: 'Без наличников', en: 'No casing' } },
  { groupKey: 'casing', optionKey: 'oneSide', priceMinor: 9_000, sort: 1, labels: { hy: 'Մի կողմից', ru: 'С одной стороны', en: 'One side' } },
  { groupKey: 'casing', optionKey: 'bothSides', priceMinor: 16_000, sort: 2, labels: { hy: 'Երկու կողմից', ru: 'С двух сторон', en: 'Both sides' } },

  { groupKey: 'handle', optionKey: 'none', priceMinor: 0, sort: 0, labels: { hy: 'Առանց բռնակի', ru: 'Без ручки', en: 'No handle' } },
  { groupKey: 'handle', optionKey: 'basic', priceMinor: 5_000, sort: 1, labels: { hy: 'Ստանդարտ բռնակ', ru: 'Стандартная ручка', en: 'Standard handle' } },
  { groupKey: 'handle', optionKey: 'design', priceMinor: 12_000, sort: 2, labels: { hy: 'Դիզայներական բռնակ', ru: 'Дизайнерская ручка', en: 'Designer handle' } },
  { groupKey: 'handle', optionKey: 'brass', priceMinor: 19_000, sort: 3, labels: { hy: 'Արույրե բռնակ', ru: 'Латунная ручка', en: 'Brass handle' } },

  { groupKey: 'lock', optionKey: 'none', priceMinor: 0, sort: 0, labels: { hy: 'Առանց կողպեքի', ru: 'Без замка', en: 'No lock' } },
  { groupKey: 'lock', optionKey: 'latch', priceMinor: 4_000, sort: 1, labels: { hy: 'Պարզ փական', ru: 'Защёлка', en: 'Latch' } },
  { groupKey: 'lock', optionKey: 'magnetic', priceMinor: 8_000, sort: 2, labels: { hy: 'Մագնիսական փական', ru: 'Магнитная защёлка', en: 'Magnetic latch' } },
  { groupKey: 'lock', optionKey: 'keyLock', priceMinor: 11_000, sort: 3, labels: { hy: 'Բանալիով կողպեք', ru: 'Замок с ключом', en: 'Key lock' } },

  { groupKey: 'opening', optionKey: 'left', priceMinor: 0, sort: 0, labels: { hy: 'Ձախ', ru: 'Левое', en: 'Left-hand' } },
  { groupKey: 'opening', optionKey: 'right', priceMinor: 0, sort: 1, labels: { hy: 'Աջ', ru: 'Правое', en: 'Right-hand' } },

  { groupKey: 'installation', optionKey: 'none', priceMinor: 0, sort: 0, labels: { hy: 'Առանց տեղադրման', ru: 'Без установки', en: 'Without installation' } },
  { groupKey: 'installation', optionKey: 'standard', priceMinor: 25_000, sort: 1, labels: { hy: 'Ստանդարտ տեղադրում', ru: 'Стандартная установка', en: 'Standard installation' } },
  { groupKey: 'installation', optionKey: 'withDemolition', priceMinor: 38_000, sort: 2, labels: { hy: 'Տեղադրում՝ հին դռան ապամոնտաժմամբ', ru: 'Установка с демонтажом старой двери', en: 'Installation with removal of the old door' } },
];
