import type { LocalizedLabel } from './attributes';

/**
 * The catalogue tree. One definition drives the seeded categories, the mega
 * menu, breadcrumbs, the generated artwork and the per-category filter sets —
 * so the store cannot drift between navigation and data.
 */
export type CategoryNode = {
  slug: string;
  /** Artwork family used by the SVG generator (see src/lib/media/artwork.ts). */
  artKey: string;
  names: LocalizedLabel;
  intro?: LocalizedLabel;
  /** Filters shown in addition to the common ones, for this branch only. */
  filterKeys?: string[];
  /** Leaf-level target product count for the demo seed. */
  productCount?: number;
  children?: CategoryNode[];
};

export const TAXONOMY: CategoryNode[] = [
  {
    slug: 'sofas',
    artKey: 'sofa',
    names: { hy: 'Բազմոցներ', ru: 'Диваны', en: 'Sofas' },
    intro: {
      hy: 'Ուղիղ, անկյունային և մոդուլային բազմոցներ՝ ամենօրյա քնելու ռեսուրսով և հանվող պատյաններով։',
      ru: 'Прямые, угловые и модульные диваны с ежедневным спальным местом, съёмными чехлами и честной гарантией на механизм.',
      en: 'Straight, corner and modular sofas with daily sleeping mechanisms, removable covers and a real warranty.',
    },
    filterKeys: ['mechanism', 'seats', 'fabricType', 'sleepingArea', 'cornerSide'],
    children: [
      {
        slug: 'straight-sofas',
        artKey: 'sofa',
        names: { hy: 'Ուղիղ բազմոցներ', ru: 'Прямые диваны', en: 'Straight sofas' },
        productCount: 8,
      },
      {
        slug: 'corner-sofas',
        artKey: 'sofa-corner',
        names: { hy: 'Անկյունային բազմոցներ', ru: 'Угловые диваны', en: 'Corner sofas' },
        productCount: 8,
      },
      {
        slug: 'modular-sofas',
        artKey: 'sofa-modular',
        names: { hy: 'Մոդուլային բազմոցներ', ru: 'Модульные диваны', en: 'Modular sofas' },
        productCount: 6,
      },
      {
        slug: 'sofa-beds',
        artKey: 'sofa',
        names: { hy: 'Հավաքովի բազմոցներ', ru: 'Раскладные диваны', en: 'Sofa beds' },
        productCount: 6,
      },
      {
        slug: 'two-seat-sofas',
        artKey: 'sofa-small',
        names: { hy: 'Երկտեղանի բազմոցներ', ru: 'Двухместные диваны', en: 'Two-seat sofas' },
        productCount: 4,
      },
      {
        slug: 'three-seat-sofas',
        artKey: 'sofa',
        names: { hy: 'Եռատեղանի բազմոցներ', ru: 'Трёхместные диваны', en: 'Three-seat sofas' },
        productCount: 5,
      },
    ],
  },
  {
    slug: 'armchairs',
    artKey: 'armchair',
    names: { hy: 'Բազկաթոռներ', ru: 'Кресла', en: 'Armchairs' },
    intro: {
      hy: 'Lounge, դասական և ռեկլայներ բազկաթոռներ՝ ընթերցանության անկյունի ու հյուրասենյակի համար։',
      ru: 'Lounge, классические и реклайнеры — кресла для кофейного угла, гостиной и кабинета.',
      en: 'Lounge, classic and recliner armchairs for a reading corner, a living room or a study.',
    },
    filterKeys: ['filler', 'seatHeight', 'maxLoad'],
    children: [
      {
        slug: 'classic-armchairs',
        artKey: 'armchair',
        names: { hy: 'Դասական բազկաթոռներ', ru: 'Классические кресла', en: 'Classic armchairs' },
        productCount: 4,
      },
      {
        slug: 'lounge-armchairs',
        artKey: 'armchair-lounge',
        names: { hy: 'Lounge բազկաթոռներ', ru: 'Кресла lounge', en: 'Lounge chairs' },
        productCount: 4,
      },
      {
        slug: 'recliners',
        artKey: 'recliner',
        names: { hy: 'Ռեկլայներներ', ru: 'Реклайнеры', en: 'Recliners' },
        productCount: 3,
      },
      {
        slug: 'office-armchairs',
        artKey: 'office-chair',
        names: { hy: 'Գրասենյակային բազկաթոռներ', ru: 'Офисные кресла', en: 'Office armchairs' },
        productCount: 3,
      },
      {
        slug: 'chair-beds',
        artKey: 'armchair',
        names: { hy: 'Բազկաթոռ-մահճակալներ', ru: 'Кресла-кровати', en: 'Chair beds' },
        productCount: 2,
      },
    ],
  },
  {
    slug: 'beds',
    artKey: 'bed',
    names: { hy: 'Մահճակալներ', ru: 'Кровати', en: 'Beds' },
    intro: {
      hy: 'Մահճակալներ՝ բարձրացվող մեխանիզմով, սպիտակեղենի արկղով և օրթոպեդիկ հիմքով։',
      ru: 'Кровати с подъёмным механизмом, бельевым ящиком и ортопедическим основанием — от односпальных до king size.',
      en: 'Beds with lift mechanisms, storage boxes and slatted bases — from single to king size.',
    },
    filterKeys: ['mattressSize', 'liftMechanism', 'linenBox', 'baseType', 'headboard'],
    children: [
      {
        slug: 'single-beds',
        artKey: 'bed-single',
        names: { hy: 'Միատեղանի մահճակալներ', ru: 'Односпальные кровати', en: 'Single beds' },
        productCount: 5,
      },
      {
        slug: 'double-beds',
        artKey: 'bed',
        names: { hy: 'Երկտեղանի մահճակալներ', ru: 'Двуспальные кровати', en: 'Double beds' },
        productCount: 7,
      },
      {
        slug: 'king-size-beds',
        artKey: 'bed',
        names: { hy: 'King size մահճակալներ', ru: 'Кровати king size', en: 'King size beds' },
        productCount: 4,
      },
      {
        slug: 'storage-beds',
        artKey: 'bed',
        names: {
          hy: 'Բարձրացվող մեխանիզմով',
          ru: 'Кровати с подъёмным механизмом',
          en: 'Storage beds',
        },
        productCount: 5,
      },
      {
        slug: 'kids-beds',
        artKey: 'bed-kids',
        names: { hy: 'Մանկական մահճակալներ', ru: 'Детские кровати', en: 'Kids beds' },
        productCount: 4,
      },
    ],
  },
  {
    slug: 'mattresses',
    artKey: 'mattress',
    names: { hy: 'Ներքնակներ', ru: 'Матрасы', en: 'Mattresses' },
    intro: {
      hy: 'Անկախ զսպանակներով, լատեքսե և memory foam ներքնակներ՝ երեք կոշտության մակարդակով։',
      ru: 'Матрасы на независимых пружинах, латексные и memory foam — три степени жёсткости и честная нагрузка на спальное место.',
      en: 'Pocket-spring, latex and memory-foam mattresses in three firmness levels.',
    },
    filterKeys: ['springType', 'rigidity', 'mattressSize', 'maxLoadPerSleeper'],
    children: [
      {
        slug: 'pocket-spring-mattresses',
        artKey: 'mattress',
        names: { hy: 'Անկախ զսպանակներով', ru: 'На независимых пружинах', en: 'Pocket spring' },
        productCount: 6,
      },
      {
        slug: 'springless-mattresses',
        artKey: 'mattress',
        names: { hy: 'Առանց զսպանակների', ru: 'Беспружинные', en: 'Springless' },
        productCount: 5,
      },
      {
        slug: 'orthopedic-mattresses',
        artKey: 'mattress',
        names: { hy: 'Օրթոպեդիկ', ru: 'Ортопедические', en: 'Orthopedic' },
        productCount: 4,
      },
    ],
  },
  {
    slug: 'wardrobes',
    artKey: 'wardrobe',
    names: { hy: 'Պահարաններ', ru: 'Шкафы', en: 'Wardrobes' },
    intro: {
      hy: 'Բացվող, կուպե և գարդերոբային համակարգեր՝ ըստ չափսի պատրաստելու հնարավորությամբ։',
      ru: 'Распашные шкафы, купе и гардеробные системы — со сборкой и возможностью изготовления под размер ниши.',
      en: 'Hinged wardrobes, sliding-door units and walk-in systems, made to measure on request.',
    },
    filterKeys: ['doorsCount', 'mirror', 'shelvesCount', 'madeToMeasure'],
    children: [
      {
        slug: 'hinged-wardrobes',
        artKey: 'wardrobe',
        names: { hy: 'Բացվող պահարաններ', ru: 'Распашные шкафы', en: 'Hinged wardrobes' },
        productCount: 9,
      },
      {
        slug: 'sliding-wardrobes',
        artKey: 'wardrobe-sliding',
        names: { hy: 'Կուպե պահարաններ', ru: 'Шкафы-купе', en: 'Sliding wardrobes' },
        productCount: 9,
      },
      {
        slug: 'walk-in-wardrobes',
        artKey: 'wardrobe-open',
        names: { hy: 'Գարդերոբային համակարգեր', ru: 'Гардеробные системы', en: 'Walk-in systems' },
        productCount: 7,
      },
    ],
  },
  {
    slug: 'dressers',
    artKey: 'dresser',
    names: { hy: 'Կոմոդներ', ru: 'Комоды', en: 'Dressers' },
    intro: {
      hy: 'Կոմոդներ՝ հարթ փակվող դարակներով ննջասենյակի և հյուրասենյակի համար։',
      ru: 'Комоды с доводчиками — для спальни, гостиной и детской.',
      en: 'Dressers with soft-close drawers for the bedroom, living room or nursery.',
    },
    filterKeys: ['drawersCount'],
    productCount: 8,
  },
  {
    slug: 'nightstands',
    artKey: 'nightstand',
    names: { hy: 'Թումբեր', ru: 'Тумбы', en: 'Nightstands' },
    intro: {
      hy: 'Անկողնակողքի և ունիվերսալ թումբեր՝ դարակներով և բաց խորշերով։',
      ru: 'Прикроватные и универсальные тумбы с ящиками и открытыми нишами.',
      en: 'Bedside and universal nightstands with drawers and open niches.',
    },
    filterKeys: ['drawersCount'],
    productCount: 8,
  },
  {
    slug: 'shelving',
    artKey: 'shelving',
    names: { hy: 'Դարակաշարեր և դարակներ', ru: 'Стеллажи и полки', en: 'Shelving & racks' },
    intro: {
      hy: 'Բաց դարակաշարեր, կախովի դարակներ և գրադարանային համակարգեր։',
      ru: 'Открытые стеллажи, навесные полки и библиотечные системы — в том числе как перегородка для студии.',
      en: 'Open shelving, wall shelves and library systems, including room dividers.',
    },
    filterKeys: ['shelvesCount'],
    productCount: 10,
  },
  {
    slug: 'tables',
    artKey: 'table',
    names: { hy: 'Սեղաններ', ru: 'Столы', en: 'Tables' },
    intro: {
      hy: 'Ճաշի, ժուռնալային, գրասեղաններ և հավաքովի մոդելներ՝ փայտի զանգվածից մինչև կերամիկա։',
      ru: 'Обеденные, журнальные, письменные и раскладные столы — от массива дуба до керамики на металле.',
      en: 'Dining, coffee, writing and extendable tables — from solid oak to ceramic on steel.',
    },
    filterKeys: ['tableShape', 'extendable', 'topMaterial', 'seatsCount'],
    children: [
      {
        slug: 'dining-tables',
        artKey: 'table',
        names: { hy: 'Ճաշի սեղաններ', ru: 'Обеденные столы', en: 'Dining tables' },
        productCount: 5,
      },
      {
        slug: 'coffee-tables',
        artKey: 'table-coffee',
        names: { hy: 'Ժուռնալային սեղաններ', ru: 'Журнальные столы', en: 'Coffee tables' },
        productCount: 4,
      },
      {
        slug: 'writing-desks',
        artKey: 'desk',
        names: { hy: 'Գրասեղաններ', ru: 'Письменные столы', en: 'Writing desks' },
        productCount: 4,
      },
      {
        slug: 'computer-desks',
        artKey: 'desk',
        names: { hy: 'Համակարգչային սեղաններ', ru: 'Компьютерные столы', en: 'Computer desks' },
        productCount: 3,
      },
      {
        slug: 'folding-tables',
        artKey: 'table',
        names: { hy: 'Հավաքովի սեղաններ', ru: 'Раскладные столы', en: 'Folding tables' },
        productCount: 2,
      },
      {
        slug: 'office-tables',
        artKey: 'desk',
        names: { hy: 'Գրասենյակային սեղաններ', ru: 'Офисные столы', en: 'Office desks' },
        productCount: 3,
      },
    ],
  },
  {
    slug: 'chairs',
    artKey: 'chair',
    names: { hy: 'Աթոռներ', ru: 'Стулья', en: 'Chairs' },
    intro: {
      hy: 'Խոհանոցի, ճաշի, բարային և դիզայներական աթոռներ՝ ստուգված բեռնվածությամբ։',
      ru: 'Кухонные, обеденные, барные, офисные и дизайнерские стулья с проверенной максимальной нагрузкой.',
      en: 'Kitchen, dining, bar, office and designer chairs with a tested load rating.',
    },
    filterKeys: ['frameMaterial', 'upholsteryMaterial', 'maxLoad', 'seatHeight', 'stackable'],
    children: [
      {
        slug: 'kitchen-chairs',
        artKey: 'chair',
        names: { hy: 'Խոհանոցային աթոռներ', ru: 'Кухонные стулья', en: 'Kitchen chairs' },
        productCount: 7,
      },
      {
        slug: 'dining-chairs',
        artKey: 'chair-dining',
        names: { hy: 'Ճաշի աթոռներ', ru: 'Обеденные стулья', en: 'Dining chairs' },
        productCount: 7,
      },
      {
        slug: 'bar-stools',
        artKey: 'bar-stool',
        names: { hy: 'Բարային աթոռներ', ru: 'Барные стулья', en: 'Bar stools' },
        productCount: 6,
      },
      {
        slug: 'office-chairs',
        artKey: 'office-chair',
        names: { hy: 'Գրասենյակային աթոռներ', ru: 'Офисные стулья', en: 'Office chairs' },
        productCount: 6,
      },
      {
        slug: 'designer-chairs',
        artKey: 'chair-designer',
        names: { hy: 'Դիզայներական աթոռներ', ru: 'Дизайнерские стулья', en: 'Designer chairs' },
        productCount: 4,
      },
    ],
  },
  {
    slug: 'kitchens',
    artKey: 'kitchen',
    names: { hy: 'Խոհանոցի կահույք', ru: 'Кухонная мебель', en: 'Kitchen furniture' },
    intro: {
      hy: 'Պատրաստի և մոդուլային խոհանոցներ, կղզյակներ և սեղանասալեր՝ անվճար չափագրմամբ։',
      ru: 'Готовые и модульные кухни, острова и столешницы — с бесплатным замером и расчётом по вашим размерам.',
      en: 'Ready-made and modular kitchens, islands and countertops — with a free on-site measurement.',
    },
    filterKeys: [
      'kitchenLength',
      'facadeType',
      'bodyMaterial',
      'countertopMaterial',
      'configuration',
      'madeToMeasure',
    ],
    children: [
      {
        slug: 'ready-kitchens',
        artKey: 'kitchen',
        names: { hy: 'Պատրաստի խոհանոցներ', ru: 'Готовые кухни', en: 'Ready kitchens' },
        productCount: 6,
      },
      {
        slug: 'modular-kitchens',
        artKey: 'kitchen',
        names: { hy: 'Մոդուլային խոհանոցներ', ru: 'Модульные кухни', en: 'Modular kitchens' },
        productCount: 5,
      },
      {
        slug: 'upper-cabinets',
        artKey: 'kitchen-cabinet',
        names: { hy: 'Վերին պահարաններ', ru: 'Верхние шкафы', en: 'Wall cabinets' },
        productCount: 3,
      },
      {
        slug: 'lower-cabinets',
        artKey: 'kitchen-cabinet',
        names: { hy: 'Ներքին պահարաններ', ru: 'Нижние шкафы', en: 'Base cabinets' },
        productCount: 3,
      },
      {
        slug: 'tall-cabinets',
        artKey: 'kitchen-tall',
        names: { hy: 'Պենալներ', ru: 'Пеналы', en: 'Tall units' },
        productCount: 2,
      },
      {
        slug: 'kitchen-islands',
        artKey: 'kitchen-island',
        names: { hy: 'Խոհանոցային կղզյակներ', ru: 'Кухонные острова', en: 'Kitchen islands' },
        productCount: 3,
      },
      {
        slug: 'countertops',
        artKey: 'countertop',
        names: { hy: 'Սեղանասալեր', ru: 'Столешницы', en: 'Countertops' },
        productCount: 3,
      },
    ],
  },
  {
    slug: 'hallway',
    artKey: 'hallway',
    names: { hy: 'Նախասենյակ', ru: 'Прихожая', en: 'Hallway' },
    intro: {
      hy: 'Կոշիկի պահարաններ, կախիչներ և հայելային հավաքածուներ՝ նեղ նախասենյակների համար։',
      ru: 'Обувницы, вешалки, шкафы и зеркальные комплекты — в том числе для узких прихожих глубиной 30 см.',
      en: 'Shoe racks, coat stands, cabinets and mirror sets — including 30 cm deep units for narrow hallways.',
    },
    children: [
      {
        slug: 'shoe-racks',
        artKey: 'shoe-rack',
        names: { hy: 'Կոշիկի պահարաններ', ru: 'Обувницы', en: 'Shoe racks' },
        productCount: 3,
      },
      {
        slug: 'coat-racks',
        artKey: 'coat-rack',
        names: { hy: 'Կախիչներ', ru: 'Вешалки', en: 'Coat racks' },
        productCount: 3,
      },
      {
        slug: 'hallway-cabinets',
        artKey: 'hallway',
        names: { hy: 'Նախասենյակի պահարաններ', ru: 'Шкафы для прихожей', en: 'Hallway cabinets' },
        productCount: 2,
      },
      {
        slug: 'mirror-sets',
        artKey: 'mirror',
        names: { hy: 'Հայելային հավաքածուներ', ru: 'Зеркальные комплекты', en: 'Mirror sets' },
        productCount: 2,
      },
    ],
  },
  {
    slug: 'kids',
    artKey: 'kids',
    names: { hy: 'Մանկական կահույք', ru: 'Детская мебель', en: 'Kids furniture' },
    intro: {
      hy: 'Անվտանգ նյութեր, կլորացված անկյուններ և աճող հետ մեծացող կահույք։',
      ru: 'Безопасные материалы, скруглённые углы и мебель, которая растёт вместе с ребёнком.',
      en: 'Safe materials, rounded corners and furniture that grows with the child.',
    },
    filterKeys: ['ageGroup', 'adjustableHeight'],
    productCount: 10,
  },
  {
    slug: 'office',
    artKey: 'office',
    names: { hy: 'Գրասենյակային կահույք', ru: 'Офисная мебель', en: 'Office furniture' },
    intro: {
      hy: 'Աշխատատեղեր, կոնֆերանս սեղաններ և պահեստավորման համակարգեր թիմերի համար։',
      ru: 'Рабочие места, переговорные столы и системы хранения — для команд от 2 до 50 человек.',
      en: 'Workstations, meeting tables and storage systems for teams of 2 to 50.',
    },
    filterKeys: ['adjustableHeight', 'cableManagement'],
    productCount: 10,
  },
  {
    slug: 'living-room',
    artKey: 'tv-stand',
    names: {
      hy: 'Հյուրասենյակ և TV թումբեր',
      ru: 'ТВ-тумбы и гостиная',
      en: 'Living room & TV units',
    },
    intro: {
      hy: 'TV թումբեր, պատային համակարգեր և վիտրինաներ՝ մալուխների կազմակերպմամբ։',
      ru: 'ТВ-тумбы, стенки и витрины с кабель-менеджментом и скрытой подсветкой.',
      en: 'TV units, wall systems and display cabinets with cable management and hidden lighting.',
    },
    filterKeys: ['cableManagement', 'drawersCount'],
    children: [
      {
        slug: 'tv-stands',
        artKey: 'tv-stand',
        names: { hy: 'TV թումբեր', ru: 'ТВ-тумбы', en: 'TV stands' },
        productCount: 6,
      },
      {
        slug: 'wall-systems',
        artKey: 'wall-system',
        names: { hy: 'Պատային համակարգեր', ru: 'Стенки и модульные системы', en: 'Wall systems' },
        productCount: 4,
      },
    ],
  },
  {
    slug: 'doors',
    artKey: 'door',
    names: { hy: 'Դռներ', ru: 'Двери', en: 'Doors' },
    intro: {
      hy: 'Միջսենյակային, մուտքի, սահող և թաքնված դռներ՝ կոնֆիգուրատորով և տեղադրմամբ։',
      ru: 'Межкомнатные, входные, раздвижные и скрытые двери — с конфигуратором комплектации и установкой «под ключ».',
      en: 'Interior, entrance, sliding and hidden doors — configurable, with turnkey installation.',
    },
    filterKeys: [
      'doorHeight',
      'doorWidth',
      'coating',
      'openingType',
      'openingSide',
      'frameIncluded',
    ],
    children: [
      {
        slug: 'interior-doors',
        artKey: 'door',
        names: { hy: 'Միջսենյակային դռներ', ru: 'Межкомнатные двери', en: 'Interior doors' },
        productCount: 6,
      },
      {
        slug: 'entrance-doors',
        artKey: 'door-entrance',
        names: { hy: 'Մուտքի դռներ', ru: 'Входные двери', en: 'Entrance doors' },
        productCount: 4,
      },
      {
        slug: 'sliding-doors',
        artKey: 'door-sliding',
        names: { hy: 'Սահող դռներ', ru: 'Раздвижные двери', en: 'Sliding doors' },
        productCount: 3,
      },
      {
        slug: 'hidden-doors',
        artKey: 'door-hidden',
        names: { hy: 'Թաքնված դռներ', ru: 'Скрытые двери', en: 'Hidden doors' },
        productCount: 2,
      },
      {
        slug: 'glass-doors',
        artKey: 'door-glass',
        names: { hy: 'Ապակե դռներ', ru: 'Стеклянные двери', en: 'Glass doors' },
        productCount: 3,
      },
      {
        slug: 'classic-doors',
        artKey: 'door-classic',
        names: { hy: 'Դասական դռներ', ru: 'Классические двери', en: 'Classic doors' },
        productCount: 2,
      },
      {
        slug: 'modern-doors',
        artKey: 'door',
        names: { hy: 'Ժամանակակից դռներ', ru: 'Современные двери', en: 'Modern doors' },
        productCount: 2,
      },
    ],
  },
];

/** Flattens the tree into leaves that actually carry products. */
export const productLeaves = (): { node: CategoryNode; rootSlug: string }[] => {
  const leaves: { node: CategoryNode; rootSlug: string }[] = [];
  for (const root of TAXONOMY) {
    if (root.children?.length) {
      for (const child of root.children) leaves.push({ node: child, rootSlug: root.slug });
    } else {
      leaves.push({ node: root, rootSlug: root.slug });
    }
  }
  return leaves;
};

export const totalSeedProducts = (): number =>
  productLeaves().reduce((sum, leaf) => sum + (leaf.node.productCount ?? 0), 0);
