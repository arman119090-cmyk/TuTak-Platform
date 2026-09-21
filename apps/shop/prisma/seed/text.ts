import type { LocalizedLabel } from '../../src/data/attributes';

/**
 * Copy templates for the generated catalogue.
 *
 * The demo needs 280 products that read like a real shop wrote them, in three
 * languages. Hand-writing 840 descriptions is not the goal; what matters is
 * that every text is grammatical, on-topic for its category and varied enough
 * that two neighbouring cards never look copy-pasted. So each description is
 * assembled from a category-specific opening, one of several neutral bodies and
 * a category-specific closing, with the product's own numbers substituted in.
 */

export type ProductKind =
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'mattress'
  | 'wardrobe'
  | 'dresser'
  | 'nightstand'
  | 'shelving'
  | 'table'
  | 'desk'
  | 'chair'
  | 'kitchen'
  | 'countertop'
  | 'hallway'
  | 'kids'
  | 'office'
  | 'living'
  | 'door';

/** Noun used to build the product title, e.g. "Диван угловой NORDA…". */
export const TYPE_NAMES: Record<string, LocalizedLabel> = {
  'straight-sofas': { hy: 'Ուղիղ բազմոց', ru: 'Диван прямой', en: 'Straight sofa' },
  'corner-sofas': { hy: 'Անկյունային բազմոց', ru: 'Диван угловой', en: 'Corner sofa' },
  'modular-sofas': { hy: 'Մոդուլային բազմոց', ru: 'Диван модульный', en: 'Modular sofa' },
  'sofa-beds': { hy: 'Հավաքովի բազմոց', ru: 'Диван-кровать', en: 'Sofa bed' },
  'two-seat-sofas': { hy: 'Երկտեղանի բազմոց', ru: 'Диван двухместный', en: 'Two-seat sofa' },
  'three-seat-sofas': { hy: 'Եռատեղանի բազմոց', ru: 'Диван трёхместный', en: 'Three-seat sofa' },
  'classic-armchairs': { hy: 'Բազկաթոռ', ru: 'Кресло', en: 'Armchair' },
  'lounge-armchairs': { hy: 'Lounge բազկաթոռ', ru: 'Кресло lounge', en: 'Lounge chair' },
  recliners: { hy: 'Ռեկլայներ', ru: 'Кресло-реклайнер', en: 'Recliner' },
  'office-armchairs': { hy: 'Գրասենյակային բազկաթոռ', ru: 'Кресло офисное', en: 'Office armchair' },
  'chair-beds': { hy: 'Բազկաթոռ-մահճակալ', ru: 'Кресло-кровать', en: 'Chair bed' },
  'single-beds': { hy: 'Միատեղանի մահճակալ', ru: 'Кровать односпальная', en: 'Single bed' },
  'double-beds': { hy: 'Երկտեղանի մահճակալ', ru: 'Кровать двуспальная', en: 'Double bed' },
  'king-size-beds': { hy: 'King size մահճակալ', ru: 'Кровать king size', en: 'King size bed' },
  'storage-beds': { hy: 'Մահճակալ բարձրացվող մեխանիզմով', ru: 'Кровать с подъёмным механизмом', en: 'Storage bed' },
  'kids-beds': { hy: 'Մանկական մահճակալ', ru: 'Кровать детская', en: 'Kids bed' },
  'pocket-spring-mattresses': { hy: 'Ներքնակ անկախ զսպանակներով', ru: 'Матрас на независимых пружинах', en: 'Pocket spring mattress' },
  'springless-mattresses': { hy: 'Անզսպանակ ներքնակ', ru: 'Матрас беспружинный', en: 'Springless mattress' },
  'orthopedic-mattresses': { hy: 'Օրթոպեդիկ ներքնակ', ru: 'Матрас ортопедический', en: 'Orthopedic mattress' },
  'hinged-wardrobes': { hy: 'Բացվող պահարան', ru: 'Шкаф распашной', en: 'Hinged wardrobe' },
  'sliding-wardrobes': { hy: 'Կուպե պահարան', ru: 'Шкаф-купе', en: 'Sliding wardrobe' },
  'walk-in-wardrobes': { hy: 'Գարդերոբային համակարգ', ru: 'Гардеробная система', en: 'Walk-in system' },
  dressers: { hy: 'Կոմոդ', ru: 'Комод', en: 'Dresser' },
  nightstands: { hy: 'Թումբ', ru: 'Тумба', en: 'Nightstand' },
  shelving: { hy: 'Դարակաշար', ru: 'Стеллаж', en: 'Shelving unit' },
  'dining-tables': { hy: 'Ճաշի սեղան', ru: 'Стол обеденный', en: 'Dining table' },
  'coffee-tables': { hy: 'Ժուռնալային սեղան', ru: 'Стол журнальный', en: 'Coffee table' },
  'writing-desks': { hy: 'Գրասեղան', ru: 'Стол письменный', en: 'Writing desk' },
  'computer-desks': { hy: 'Համակարգչային սեղան', ru: 'Стол компьютерный', en: 'Computer desk' },
  'folding-tables': { hy: 'Հավաքովի սեղան', ru: 'Стол раскладной', en: 'Folding table' },
  'office-tables': { hy: 'Գրասենյակային սեղան', ru: 'Стол офисный', en: 'Office desk' },
  'kitchen-chairs': { hy: 'Խոհանոցային աթոռ', ru: 'Стул кухонный', en: 'Kitchen chair' },
  'dining-chairs': { hy: 'Ճաշի աթոռ', ru: 'Стул обеденный', en: 'Dining chair' },
  'bar-stools': { hy: 'Բարային աթոռ', ru: 'Стул барный', en: 'Bar stool' },
  'office-chairs': { hy: 'Գրասենյակային աթոռ', ru: 'Стул офисный', en: 'Office chair' },
  'designer-chairs': { hy: 'Դիզայներական աթոռ', ru: 'Стул дизайнерский', en: 'Designer chair' },
  'ready-kitchens': { hy: 'Պատրաստի խոհանոց', ru: 'Кухня готовая', en: 'Ready kitchen' },
  'modular-kitchens': { hy: 'Մոդուլային խոհանոց', ru: 'Кухня модульная', en: 'Modular kitchen' },
  'upper-cabinets': { hy: 'Վերին պահարան', ru: 'Шкаф верхний', en: 'Wall cabinet' },
  'lower-cabinets': { hy: 'Ներքին պահարան', ru: 'Шкаф нижний', en: 'Base cabinet' },
  'tall-cabinets': { hy: 'Պենալ', ru: 'Пенал кухонный', en: 'Tall unit' },
  'kitchen-islands': { hy: 'Խոհանոցային կղզյակ', ru: 'Остров кухонный', en: 'Kitchen island' },
  countertops: { hy: 'Սեղանասալ', ru: 'Столешница', en: 'Countertop' },
  'shoe-racks': { hy: 'Կոշիկի պահարան', ru: 'Обувница', en: 'Shoe rack' },
  'coat-racks': { hy: 'Կախիչ', ru: 'Вешалка', en: 'Coat rack' },
  'hallway-cabinets': { hy: 'Նախասենյակի պահարան', ru: 'Шкаф в прихожую', en: 'Hallway cabinet' },
  'mirror-sets': { hy: 'Հայելային հավաքածու', ru: 'Зеркальный комплект', en: 'Mirror set' },
  kids: { hy: 'Մանկական կահույք', ru: 'Детская мебель', en: 'Kids furniture' },
  office: { hy: 'Գրասենյակային կահույք', ru: 'Офисная мебель', en: 'Office furniture' },
  'tv-stands': { hy: 'TV թումբ', ru: 'ТВ-тумба', en: 'TV stand' },
  'wall-systems': { hy: 'Պատային համակարգ', ru: 'Стенка модульная', en: 'Wall system' },
  'interior-doors': { hy: 'Միջսենյակային դուռ', ru: 'Дверь межкомнатная', en: 'Interior door' },
  'entrance-doors': { hy: 'Մուտքի դուռ', ru: 'Дверь входная', en: 'Entrance door' },
  'sliding-doors': { hy: 'Սահող դուռ', ru: 'Дверь раздвижная', en: 'Sliding door' },
  'hidden-doors': { hy: 'Թաքնված դուռ', ru: 'Дверь скрытая', en: 'Hidden door' },
  'glass-doors': { hy: 'Ապակե դուռ', ru: 'Дверь стеклянная', en: 'Glass door' },
  'classic-doors': { hy: 'Դասական դուռ', ru: 'Дверь классическая', en: 'Classic door' },
  'modern-doors': { hy: 'Ժամանակակից դուռ', ru: 'Дверь современная', en: 'Modern door' },
};

/** Opening sentence: what this piece is and who it is for. */
export const KIND_INTRO: Record<ProductKind, LocalizedLabel[]> = {
  sofa: [
    {
      hy: '{model}-ը հավաքված է ամուր փայտե կմախքի վրա և պահպանում է ձևը տարիներ շարունակ՝ նույնիսկ ամենօրյա օգտագործման դեպքում։',
      ru: '{model} собран на прочном деревянном каркасе и держит форму годами — даже если на нём сидят каждый день.',
      en: '{model} is built on a solid timber frame and keeps its shape for years, even in daily use.',
    },
    {
      hy: 'Հարմարավետ նստելու խորություն և ամուր լցոնիչ՝ {model}-ը հավասարապես հարմար է և՛ ֆիլմ դիտելու, և՛ հյուրերի համար։',
      ru: 'Комфортная глубина посадки и упругий наполнитель: {model} одинаково удобен и для вечера с фильмом, и для гостей.',
      en: 'A comfortable seat depth and resilient filling make {model} work both for a film night and for guests.',
    },
  ],
  armchair: [
    {
      hy: '{model}-ը ստեղծված է ընթերցանության անկյան համար՝ ճիշտ թեքությամբ մեջք և հենարան գոտկատեղին։',
      ru: '{model} создан для кресельного угла: правильный наклон спинки и поддержка поясницы.',
      en: '{model} is made for a reading corner: the right backrest angle and real lumbar support.',
    },
  ],
  bed: [
    {
      hy: '{model}-ի կմախքը հաշվարկված է ամենօրյա բեռնվածության համար և չի ճռռում տարիներ անց։',
      ru: 'Каркас {model} рассчитан на ежедневную нагрузку и не начинает скрипеть через год.',
      en: 'The {model} frame is engineered for daily load and does not start creaking after a year.',
    },
  ],
  mattress: [
    {
      hy: '{model} ներքնակը հավասարաչափ բաշխում է բեռը և պահում ողնաշարը բնական դիրքում։',
      ru: 'Матрас {model} равномерно распределяет нагрузку и держит позвоночник в естественном положении.',
      en: 'The {model} mattress spreads the load evenly and keeps the spine in a natural position.',
    },
  ],
  wardrobe: [
    {
      hy: '{model}-ի ներսում մտածված է ամեն սանտիմետրը՝ ձողեր, դարակներ և արկղեր ամենօրյա իրերի համար։',
      ru: 'Внутри {model} продуман каждый сантиметр: штанги, полки и ящики под вещи на каждый день.',
      en: 'Every centimetre inside {model} is planned: rails, shelves and drawers for everyday things.',
    },
  ],
  dresser: [
    {
      hy: '{model}-ի դարակները բացվում են ամբողջ երկարությամբ և փակվում են հարթ՝ առանց հարվածի։',
      ru: 'Ящики {model} выдвигаются на полную длину и закрываются мягко, без хлопка.',
      en: 'The {model} drawers pull out fully and close softly, without a slam.',
    },
  ],
  nightstand: [
    {
      hy: '{model}-ը տեղավորում է գիրքը, լիցքավորիչը և ակնոցը՝ առանց մահճակալի կողքին տեղ զբաղեցնելու։',
      ru: '{model} вмещает книгу, зарядку и очки и не загромождает место у кровати.',
      en: '{model} holds a book, a charger and your glasses without crowding the bedside.',
    },
  ],
  shelving: [
    {
      hy: '{model}-ը հավասարապես լավ է աշխատում և՛ որպես գրադարան, և՛ որպես սենյակի բաժանարար։',
      ru: '{model} одинаково хорошо работает и как библиотека, и как перегородка в студии.',
      en: '{model} works equally well as a library and as a room divider in a studio.',
    },
  ],
  table: [
    {
      hy: '{model}-ի մակերեսը դիմացկուն է տաք բաժակների և ամենօրյա մաքրման նկատմամբ։',
      ru: 'Столешница {model} спокойно переносит горячие чашки и ежедневную уборку.',
      en: 'The {model} top takes hot cups and daily wiping in its stride.',
    },
  ],
  desk: [
    {
      hy: '{model}-ի աշխատանքային մակերեսը բավական է երկու մոնիտորի համար՝ մալուխների անցքով։',
      ru: 'Рабочей поверхности {model} хватает на два монитора, а провода уходят в кабель-канал.',
      en: 'The {model} worktop fits two monitors, with the cables routed out of sight.',
    },
  ],
  chair: [
    {
      hy: '{model}-ի կմախքը ստուգված է բեռնվածության վրա, իսկ նստատեղը պահպանում է ձևը։',
      ru: 'Каркас {model} проверен на нагрузку, а сиденье не «проседает» со временем.',
      en: 'The {model} frame is load-tested and the seat does not sag over time.',
    },
  ],
  kitchen: [
    {
      hy: '{model}-ը հավաքվում է մոդուլներից՝ ձեր խոհանոցի չափսերի տակ, ներառյալ ոչ ստանդարտ խորշերը։',
      ru: '{model} собирается из модулей под размеры вашей кухни, включая нестандартные ниши.',
      en: '{model} is assembled from modules to fit your kitchen, awkward niches included.',
    },
  ],
  countertop: [
    {
      hy: '{model} սեղանասալը դիմացկուն է խոնավությանը, ջերմությանը և կտրվածքներին։',
      ru: 'Столешница {model} устойчива к влаге, нагреву и порезам.',
      en: 'The {model} countertop resists moisture, heat and knife marks.',
    },
  ],
  hallway: [
    {
      hy: '{model}-ը նախատեսված է նեղ նախասենյակի համար և չի «ուտում» անցուղին։',
      ru: '{model} рассчитан на узкую прихожую и не «съедает» проход.',
      en: '{model} is designed for a narrow hallway and does not eat up the passage.',
    },
  ],
  kids: [
    {
      hy: '{model}-ի բոլոր անկյունները կլորացված են, իսկ ծածկույթը՝ անվտանգ երեխաների սենյակի համար։',
      ru: 'Все углы {model} скруглены, покрытие безопасно для детской комнаты.',
      en: 'Every corner of {model} is rounded and the finish is safe for a child’s room.',
    },
  ],
  office: [
    {
      hy: '{model}-ը մտածված է աշխատատեղերի համար, որոնք աճում են թիմի հետ միասին։',
      ru: '{model} рассчитан на рабочие места, которые растут вместе с командой.',
      en: '{model} is built for workstations that grow with the team.',
    },
  ],
  living: [
    {
      hy: '{model}-ը թաքցնում է մալուխները և պահում տեխնիկան՝ առանց հյուրասենյակը ծանրաբեռնելու։',
      ru: '{model} прячет провода и держит технику, не перегружая гостиную.',
      en: '{model} hides the cables and holds the electronics without crowding the living room.',
    },
  ],
  door: [
    {
      hy: '{model}-ը մատակարարվում է շրջանակի և ֆուռնիտուրայի հետ, իսկ տեղադրումը կարելի է պատվիրել նույն զամբյուղում։',
      ru: '{model} поставляется с коробкой и фурнитурой, а установку можно заказать в той же корзине.',
      en: '{model} ships with the frame and hardware, and installation can be added in the same cart.',
    },
  ],
};

/** Neutral body sentences with the product's own numbers. */
export const BODY_TEMPLATES: LocalizedLabel[] = [
  {
    hy: 'Չափսերը՝ {width} × {depth} × {height} սմ, ուստի հեշտ է նախապես ստուգել՝ կտեղավորվի՞ ընտրված տեղում։ Արտադրությունը՝ {country}, երաշխիքը՝ {warranty} ամիս։',
    ru: 'Габариты — {width} × {depth} × {height} см, поэтому легко проверить заранее, встанет ли модель на выбранное место. Производство — {country}, гарантия — {warranty} мес.',
    en: 'Dimensions are {width} × {depth} × {height} cm, so it is easy to check in advance whether it fits. Made in {country}, {warranty} months warranty.',
  },
  {
    hy: '{material} նյութը հեշտ է խնամել՝ բավական է չոր փափուկ շորը։ Մոդելի չափսերը՝ {width} × {depth} × {height} սմ, երաշխիքը՝ {warranty} ամիս։',
    ru: 'Материал — {material}: уход сводится к сухой мягкой ткани. Размеры модели — {width} × {depth} × {height} см, гарантия — {warranty} мес.',
    en: 'The {material} finish needs nothing more than a dry soft cloth. The model measures {width} × {depth} × {height} cm, with {warranty} months of warranty.',
  },
  {
    hy: 'Հավաքածուի գույնը՝ {color}։ Չափսերը՝ {width} × {depth} × {height} սմ։ Առաքումն ու հավաքումը կարելի է պատվիրել պատվերը ձևակերպելիս։',
    ru: 'Цвет модели — {color}. Габариты — {width} × {depth} × {height} см. Доставку и сборку можно добавить при оформлении заказа.',
    en: 'The colour is {color} and the piece measures {width} × {depth} × {height} cm. Delivery and assembly can be added at checkout.',
  },
  {
    hy: 'Մոդելը պատրաստված է {material}-ից {color} երանգով և տեղավորվում է {width} սմ լայնությամբ տարածքում։ Երաշխիքը՝ {warranty} ամիս։',
    ru: 'Модель выполнена из материала «{material}» в цвете «{color}» и занимает {width} см по ширине. Гарантия — {warranty} мес.',
    en: 'Made from {material} in {color}, the piece takes {width} cm of width. Warranty: {warranty} months.',
  },
];

/** Closing sentence: the commercial promise. */
export const KIND_CLOSING: Record<ProductKind, LocalizedLabel> = {
  sofa: {
    hy: 'Պատյանները հանվող են՝ մաքրումը չի պահանջում մասնագետ։',
    ru: 'Чехлы съёмные — химчистка не понадобится ради одного пятна.',
    en: 'The covers come off, so one stain does not mean a professional clean.',
  },
  armchair: {
    hy: 'Հարմար է և՛ հյուրասենյակին, և՛ ննջասենյակի ընթերցանության անկյանը։',
    ru: 'Одинаково уместно в гостиной и в спальне у окна.',
    en: 'Equally at home in a living room or by a bedroom window.',
  },
  bed: {
    hy: 'Ներքնակը ընտրեք առանձին՝ կատալոգի «Ներքնակներ» բաժնից։',
    ru: 'Матрас подбирается отдельно — в разделе «Матрасы».',
    en: 'The mattress is chosen separately, in the Mattresses section.',
  },
  mattress: {
    hy: 'Պատյանը հանվող է և լվացվում է 30 °C-ում։',
    ru: 'Чехол съёмный и стирается при 30 °C.',
    en: 'The cover is removable and washes at 30 °C.',
  },
  wardrobe: {
    hy: 'Հնարավոր է պատրաստել ձեր խորշի ճշգրիտ չափսերով։',
    ru: 'Возможно изготовление под точные размеры вашей ниши.',
    en: 'Can be made to the exact dimensions of your niche.',
  },
  dresser: {
    hy: 'Հարմար է և՛ ննջասենյակին, և՛ նախասենյակին։',
    ru: 'Подходит и для спальни, и для прихожей.',
    en: 'Works in a bedroom as well as in a hallway.',
  },
  nightstand: {
    hy: 'Համադրվում է նույն հավաքածուի մահճակալի և կոմոդի հետ։',
    ru: 'Сочетается с кроватью и комодом из той же коллекции.',
    en: 'Matches the bed and dresser from the same collection.',
  },
  shelving: {
    hy: 'Դարակների բարձրությունը կարգավորվում է հավաքման ժամանակ։',
    ru: 'Высота полок регулируется при сборке.',
    en: 'Shelf heights are adjustable during assembly.',
  },
  table: {
    hy: 'Համադրեք նույն հավաքածուի աթոռների հետ՝ ամբողջական ճաշի խումբ ստանալու համար։',
    ru: 'Соберите обеденную группу со стульями из той же коллекции.',
    en: 'Pair it with chairs from the same collection for a full dining set.',
  },
  desk: {
    hy: 'Մալուխների ելքը նախատեսված է հետևի պատին։',
    ru: 'Вывод для проводов предусмотрен в задней стенке.',
    en: 'A cable outlet is built into the back panel.',
  },
  chair: {
    hy: 'Պատվիրեք 4 կամ 6 հատ՝ ամբողջական հավաքածուի համար։',
    ru: 'Чаще всего берут по 4 или 6 штук — на всю семью.',
    en: 'Most people order four or six — enough for the whole table.',
  },
  kitchen: {
    hy: 'Անվճար չափագրումից հետո կստանաք ճշգրիտ նախահաշիվ և 3 հատակագիծ։',
    ru: 'После бесплатного замера вы получаете точную смету и 3 варианта планировки.',
    en: 'After the free measurement you receive an exact quote and three layouts.',
  },
  countertop: {
    hy: 'Կտրվածքները լվացարանի և վառարանի տակ կատարվում են ըստ ձեր տեխնիկայի։',
    ru: 'Вырезы под мойку и варочную панель делаются под вашу технику.',
    en: 'Sink and hob cut-outs are made to your appliances.',
  },
  hallway: {
    hy: 'Խորությունը թույլ է տալիս տեղադրել նույնիսկ 120 սմ միջանցքում։',
    ru: 'Глубина позволяет поставить даже в коридор шириной 120 см.',
    en: 'Shallow enough for a 120 cm wide corridor.',
  },
  kids: {
    hy: 'Ծածկույթը հիպոալերգեն է և ունի անվտանգության վկայական։',
    ru: 'Покрытие гипоаллергенное, с сертификатом безопасности.',
    en: 'The finish is hypoallergenic and safety certified.',
  },
  office: {
    hy: 'Հասանելի է նաև մեծաքանակ պատվերով՝ թիմերի համար։',
    ru: 'Доступно оптом — под оснащение целого офиса.',
    en: 'Available in bulk for fitting out a whole office.',
  },
  living: {
    hy: 'Մոդուլները կարելի է համադրել իրար հետ՝ ըստ պատի երկարության։',
    ru: 'Модули комбинируются между собой под длину вашей стены.',
    en: 'The modules combine freely to match your wall length.',
  },
  door: {
    hy: 'Կոնֆիգուրատորում ընտրեք չափսը, ծածկույթը և ֆուռնիտուրան՝ գինը կվերահաշվարկվի։',
    ru: 'В конфигураторе выберите размер, покрытие и фурнитуру — цена пересчитается сразу.',
    en: 'Pick the size, finish and hardware in the configurator — the price updates instantly.',
  },
};

/** Short card description, one line. */
export const SHORT_TEMPLATES: LocalizedLabel[] = [
  { hy: '{material}, {color}, {width} սմ լայնություն', ru: '{material}, {color}, ширина {width} см', en: '{material}, {color}, {width} cm wide' },
  { hy: '{color} երանգ, {material}, երաշխիք {warranty} ամիս', ru: 'Цвет «{color}», {material}, гарантия {warranty} мес.', en: '{color}, {material}, {warranty} months warranty' },
  { hy: '{width} × {depth} × {height} սմ, {material}', ru: '{width} × {depth} × {height} см, {material}', en: '{width} × {depth} × {height} cm, {material}' },
];

/** Review bodies, picked per rating band. */
export const REVIEW_TEXTS: { rating: number; texts: LocalizedLabel[] }[] = [
  {
    rating: 5,
    texts: [
      { hy: 'Առաքումը եղավ խոստացված օրը, հավաքողները մաքուր աշխատեցին։ Որակը գնին համապատասխանում է։', ru: 'Привезли в обещанный день, сборщики работали аккуратно и забрали упаковку. Качество соответствует цене.', en: 'Delivered on the promised day, the fitters worked cleanly and took the packaging away. Quality matches the price.' },
      { hy: 'Գույնը նույնն է, ինչ կայքում։ Երկու ամիս օգտագործում ենք՝ ոչ մի բողոք։', ru: 'Цвет точно как на сайте. Пользуемся два месяца — никаких нареканий.', en: 'The colour is exactly as shown on the site. Two months in and no complaints.' },
      { hy: 'Երկար ընտրում էինք, և սա միակն էր, որ տեղավորվեց խորշի մեջ։ Շատ գոհ ենք։', ru: 'Долго выбирали, и это единственная модель, которая встала в нишу миллиметр в миллиметр.', en: 'We looked for a long time and this is the only model that fitted the niche to the millimetre.' },
    ],
  },
  {
    rating: 4,
    texts: [
      { hy: 'Ամեն ինչ լավ է, բայց առաքումը մեկ օր ուշացավ։ Ապրանքն ինքը՝ գերազանց։', ru: 'Всё хорошо, но доставку сдвинули на день. Сам товар отличный.', en: 'All good, though delivery slipped by a day. The product itself is excellent.' },
      { hy: 'Որակը լավն է, հավաքումը մի փոքր ժամանակ խլեց։', ru: 'Качество хорошее, сборка заняла чуть больше времени, чем ожидали.', en: 'Good quality; assembly took a bit longer than we expected.' },
    ],
  },
  {
    rating: 3,
    texts: [
      { hy: 'Գինը համապատասխանում է որակին, բայց երանգը մի փոքր ավելի մուգ է, քան լուսանկարում։', ru: 'Цена соответствует качеству, но оттенок чуть темнее, чем на фото.', en: 'Fair for the price, but the shade is a touch darker than in the photos.' },
    ],
  },
];

export const REVIEW_TITLES: LocalizedLabel[] = [
  { hy: 'Գոհ եմ գնումից', ru: 'Покупкой довольна', en: 'Happy with the purchase' },
  { hy: 'Տեղավորվեց ճիշտ', ru: 'Встало идеально', en: 'Fitted perfectly' },
  { hy: 'Լավ գին-որակ հարաբերակցություն', ru: 'Хорошее соотношение цены и качества', en: 'Good value for money' },
  { hy: 'Սպասածից լավն էր', ru: 'Лучше, чем ожидали', en: 'Better than expected' },
];

export const REVIEW_AUTHORS = [
  'Ани М.', 'Давид А.', 'Лусине Г.', 'Арам С.', 'Нарине К.', 'Гор П.', 'Мариам О.', 'Тигран В.',
  'Седа Б.', 'Ваге Н.', 'Каринэ Д.', 'Армен Т.', 'Асмик Р.', 'Сурен Л.', 'Нонна Ш.', 'Грайр Е.',
];
