/**
 * Canonical catalogue vocabulary.
 *
 * Products store canonical keys ("walnut", "boucle", "japandi"); the UI resolves
 * them through these dictionaries. That keeps filters language-independent while
 * every string a customer sees is a real translation, never a key.
 */

export type LocalizedLabel = { hy: string; ru: string; en: string };

export type ColorDefinition = {
  hex: string;
  /** Second tone used by the generated artwork for shading/piping. */
  shade: string;
  family: 'neutral' | 'warm' | 'cool' | 'wood' | 'accent';
  label: LocalizedLabel;
};

export const COLORS: Record<string, ColorDefinition> = {
  white: { hex: '#F6F5F2', shade: '#E2E0DA', family: 'neutral', label: { hy: 'Սպիտակ', ru: 'Белый', en: 'White' } },
  ivory: { hex: '#EFE7DA', shade: '#DBCFBC', family: 'warm', label: { hy: 'Փղոսկր', ru: 'Слоновая кость', en: 'Ivory' } },
  cream: { hex: '#E8DCC8', shade: '#D2C2A8', family: 'warm', label: { hy: 'Կրեմ', ru: 'Кремовый', en: 'Cream' } },
  sand: { hex: '#D9C7AC', shade: '#BFA985', family: 'warm', label: { hy: 'Ավազագույն', ru: 'Песочный', en: 'Sand' } },
  beige: { hex: '#CDBBA4', shade: '#B29B80', family: 'warm', label: { hy: 'Բեժ', ru: 'Бежевый', en: 'Beige' } },
  lightGrey: { hex: '#CFD0CC', shade: '#B0B1AC', family: 'neutral', label: { hy: 'Բաց մոխրագույն', ru: 'Светло-серый', en: 'Light grey' } },
  grey: { hex: '#9A9C98', shade: '#7D7F7B', family: 'neutral', label: { hy: 'Մոխրագույն', ru: 'Серый', en: 'Grey' } },
  graphite: { hex: '#5B5E60', shade: '#45484A', family: 'cool', label: { hy: 'Գրաֆիտ', ru: 'Графитовый', en: 'Graphite' } },
  anthracite: { hex: '#3C4043', shade: '#2B2E30', family: 'cool', label: { hy: 'Անտրացիտ', ru: 'Антрацит', en: 'Anthracite' } },
  black: { hex: '#22242A', shade: '#131418', family: 'neutral', label: { hy: 'Սև', ru: 'Чёрный', en: 'Black' } },
  brown: { hex: '#6B4B36', shade: '#523725', family: 'wood', label: { hy: 'Շագանակագույն', ru: 'Коричневый', en: 'Brown' } },
  walnut: { hex: '#7A5230', shade: '#5C3C22', family: 'wood', label: { hy: 'Ընկուզենի', ru: 'Орех', en: 'Walnut' } },
  oak: { hex: '#C9A57B', shade: '#A9855C', family: 'wood', label: { hy: 'Կաղնի', ru: 'Дуб', en: 'Oak' } },
  ashWood: { hex: '#DCC6A5', shade: '#BFA783', family: 'wood', label: { hy: 'Հացենի', ru: 'Ясень', en: 'Ash' } },
  wenge: { hex: '#4A3A31', shade: '#33261F', family: 'wood', label: { hy: 'Վենգե', ru: 'Венге', en: 'Wenge' } },
  terracotta: { hex: '#B5674A', shade: '#8F4E36', family: 'accent', label: { hy: 'Տերակոտա', ru: 'Терракотовый', en: 'Terracotta' } },
  mustard: { hex: '#C79A3C', shade: '#A17B28', family: 'accent', label: { hy: 'Մանանեխի', ru: 'Горчичный', en: 'Mustard' } },
  olive: { hex: '#7C8156', shade: '#616640', family: 'accent', label: { hy: 'Ձիթապտղի', ru: 'Оливковый', en: 'Olive' } },
  emerald: { hex: '#2F6B5A', shade: '#1F5244', family: 'accent', label: { hy: 'Զմրուխտ', ru: 'Изумрудный', en: 'Emerald' } },
  navy: { hex: '#2C3E58', shade: '#1D2C42', family: 'cool', label: { hy: 'Մուգ կապույտ', ru: 'Тёмно-синий', en: 'Navy' } },
  blue: { hex: '#5C7FA3', shade: '#456686', family: 'cool', label: { hy: 'Կապույտ', ru: 'Синий', en: 'Blue' } },
  powder: { hex: '#D8B6B0', shade: '#BD958E', family: 'accent', label: { hy: 'Փոշոտ վարդագույն', ru: 'Пудровый', en: 'Powder pink' } },
};

export type MaterialGroup = 'textile' | 'leather' | 'wood' | 'board' | 'stone' | 'metal' | 'glass' | 'other';

export const MATERIALS: Record<string, { group: MaterialGroup; label: LocalizedLabel }> = {
  chenille: { group: 'textile', label: { hy: 'Շենիլ', ru: 'Шенилл', en: 'Chenille' } },
  boucle: { group: 'textile', label: { hy: 'Բուկլե', ru: 'Букле', en: 'Bouclé' } },
  velour: { group: 'textile', label: { hy: 'Վելյուր', ru: 'Велюр', en: 'Velour' } },
  rogozhka: { group: 'textile', label: { hy: 'Կոպտաթել գործվածք', ru: 'Рогожка', en: 'Basket-weave fabric' } },
  linenFabric: { group: 'textile', label: { hy: 'Կտավատ', ru: 'Лён', en: 'Linen' } },
  microfiber: { group: 'textile', label: { hy: 'Միկրոֆիբր', ru: 'Микрофибра', en: 'Microfibre' } },
  ecoLeather: { group: 'leather', label: { hy: 'Էկո կաշի', ru: 'Экокожа', en: 'Eco leather' } },
  genuineLeather: { group: 'leather', label: { hy: 'Բնական կաշի', ru: 'Натуральная кожа', en: 'Full-grain leather' } },
  oakSolid: { group: 'wood', label: { hy: 'Կաղնու զանգված', ru: 'Массив дуба', en: 'Solid oak' } },
  beechSolid: { group: 'wood', label: { hy: 'Հաճարենու զանգված', ru: 'Массив бука', en: 'Solid beech' } },
  pineSolid: { group: 'wood', label: { hy: 'Սոճու զանգված', ru: 'Массив сосны', en: 'Solid pine' } },
  ashSolid: { group: 'wood', label: { hy: 'Հացենու զանգված', ru: 'Массив ясеня', en: 'Solid ash' } },
  veneer: { group: 'wood', label: { hy: 'Բնական սպոն', ru: 'Натуральный шпон', en: 'Natural veneer' } },
  plywood: { group: 'wood', label: { hy: 'Ֆաներա', ru: 'Фанера', en: 'Plywood' } },
  mdf: { group: 'board', label: { hy: 'ՄԴՖ', ru: 'МДФ', en: 'MDF' } },
  mdfPainted: { group: 'board', label: { hy: 'Ներկված ՄԴՖ', ru: 'МДФ в эмали', en: 'Lacquered MDF' } },
  chipboard: { group: 'board', label: { hy: 'ԼԴՍՊ', ru: 'ЛДСП', en: 'Laminated chipboard' } },
  hpl: { group: 'board', label: { hy: 'HPL ծածկույթ', ru: 'HPL-пластик', en: 'HPL laminate' } },
  marble: { group: 'stone', label: { hy: 'Մարմար', ru: 'Мрамор', en: 'Marble' } },
  quartz: { group: 'stone', label: { hy: 'Քվարցագլոմերատ', ru: 'Кварцевый агломерат', en: 'Quartz composite' } },
  ceramic: { group: 'stone', label: { hy: 'Կերամիկա', ru: 'Керамика', en: 'Ceramic' } },
  metal: { group: 'metal', label: { hy: 'Մետաղ', ru: 'Металл', en: 'Powder-coated metal' } },
  steel: { group: 'metal', label: { hy: 'Չժանգոտվող պողպատ', ru: 'Нержавеющая сталь', en: 'Stainless steel' } },
  glass: { group: 'glass', label: { hy: 'Կոփած ապակի', ru: 'Закалённое стекло', en: 'Tempered glass' } },
  rattan: { group: 'other', label: { hy: 'Ռատան', ru: 'Ротанг', en: 'Rattan' } },
  plastic: { group: 'other', label: { hy: 'Պոլիպրոպիլեն', ru: 'Полипропилен', en: 'Polypropylene' } },
};

export const STYLES: Record<string, LocalizedLabel> = {
  modern: { hy: 'Ժամանակակից', ru: 'Современный', en: 'Modern' },
  minimal: { hy: 'Մինիմալիզմ', ru: 'Минимализм', en: 'Minimal' },
  scandi: { hy: 'Սկանդինավյան', ru: 'Скандинавский', en: 'Scandinavian' },
  japandi: { hy: 'Ջապանդի', ru: 'Джапанди', en: 'Japandi' },
  loft: { hy: 'Լոֆթ', ru: 'Лофт', en: 'Loft' },
  classic: { hy: 'Դասական', ru: 'Классический', en: 'Classic' },
  neoclassic: { hy: 'Նեոդասական', ru: 'Неоклассика', en: 'Neoclassical' },
  provence: { hy: 'Պրովանս', ru: 'Прованс', en: 'Provence' },
  artdeco: { hy: 'Արտ դեկո', ru: 'Ар-деко', en: 'Art déco' },
  hitech: { hy: 'Հայ-թեք', ru: 'Хай-тек', en: 'Hi-tech' },
};

export const ROOMS: Record<string, LocalizedLabel> = {
  living: { hy: 'Հյուրասենյակ', ru: 'Гостиная', en: 'Living room' },
  bedroom: { hy: 'Ննջասենյակ', ru: 'Спальня', en: 'Bedroom' },
  kitchen: { hy: 'Խոհանոց', ru: 'Кухня', en: 'Kitchen' },
  dining: { hy: 'Ճաշասենյակ', ru: 'Столовая', en: 'Dining room' },
  kids: { hy: 'Մանկական', ru: 'Детская', en: 'Kids room' },
  office: { hy: 'Աշխատասենյակ', ru: 'Кабинет', en: 'Home office' },
  hallway: { hy: 'Նախասենյակ', ru: 'Прихожая', en: 'Hallway' },
  bathroom: { hy: 'Լոգասենյակ', ru: 'Ванная', en: 'Bathroom' },
};

export const PURPOSES: Record<string, LocalizedLabel> = {
  home: { hy: 'Տան համար', ru: 'Для дома', en: 'For home' },
  office: { hy: 'Գրասենյակի համար', ru: 'Для офиса', en: 'For office' },
  horeca: { hy: 'HoReCa', ru: 'Для кафе и отелей', en: 'For HoReCa' },
  kids: { hy: 'Երեխաների համար', ru: 'Для детей', en: 'For children' },
};

/** Labels for specification keys used in the `Product.specs` map. */
export const SPEC_LABELS: Record<string, LocalizedLabel> = {
  mechanism: { hy: 'Տրանսֆորմացիայի մեխանիզմ', ru: 'Механизм трансформации', en: 'Transformation mechanism' },
  sleepingArea: { hy: 'Քնելու տեղ', ru: 'Спальное место', en: 'Sleeping area' },
  fabricType: { hy: 'Գործվածքի տեսակ', ru: 'Тип ткани', en: 'Upholstery fabric' },
  filler: { hy: 'Լցոնիչ', ru: 'Наполнитель', en: 'Filling' },
  seats: { hy: 'Նստատեղերի քանակ', ru: 'Посадочных мест', en: 'Seats' },
  cornerSide: { hy: 'Անկյան կողմ', ru: 'Угол', en: 'Corner side' },
  removableCovers: { hy: 'Հանվող պատյաններ', ru: 'Съёмные чехлы', en: 'Removable covers' },
  linenBox: { hy: 'Սպիտակեղենի արկղ', ru: 'Ящик для белья', en: 'Storage box' },
  liftMechanism: { hy: 'Բարձրացնող մեխանիզմ', ru: 'Подъёмный механизм', en: 'Lift mechanism' },
  mattressSize: { hy: 'Ներքնակի չափս', ru: 'Размер матраса', en: 'Mattress size' },
  baseType: { hy: 'Հիմքի տեսակ', ru: 'Тип основания', en: 'Base type' },
  headboard: { hy: 'Գլխամաս', ru: 'Изголовье', en: 'Headboard' },
  springType: { hy: 'Զսպանակային բլոկ', ru: 'Пружинный блок', en: 'Spring system' },
  rigidity: { hy: 'Կոշտություն', ru: 'Жёсткость', en: 'Firmness' },
  maxLoadPerSleeper: { hy: 'Առավելագույն բեռ մեկ տեղի վրա', ru: 'Макс. нагрузка на спальное место', en: 'Max load per sleeper' },
  doorsCount: { hy: 'Դռների քանակ', ru: 'Количество дверей', en: 'Doors' },
  drawersCount: { hy: 'Դարակների քանակ', ru: 'Количество ящиков', en: 'Drawers' },
  shelvesCount: { hy: 'Դարակների քանակ', ru: 'Количество полок', en: 'Shelves' },
  mirror: { hy: 'Հայելի', ru: 'Зеркало', en: 'Mirror' },
  tableShape: { hy: 'Ձև', ru: 'Форма', en: 'Shape' },
  extendable: { hy: 'Հավաքովի', ru: 'Раскладной', en: 'Extendable' },
  topMaterial: { hy: 'Սեղանի մակերես', ru: 'Материал столешницы', en: 'Table top material' },
  seatsCount: { hy: 'Տեղերի քանակ', ru: 'Количество мест', en: 'Seats' },
  frameMaterial: { hy: 'Կմախքի նյութ', ru: 'Материал каркаса', en: 'Frame material' },
  upholsteryMaterial: { hy: 'Պաստառի նյութ', ru: 'Материал обивки', en: 'Upholstery material' },
  maxLoad: { hy: 'Առավելագույն բեռնվածություն', ru: 'Максимальная нагрузка', en: 'Maximum load' },
  seatHeight: { hy: 'Նստատեղի բարձրություն', ru: 'Высота сиденья', en: 'Seat height' },
  armrests: { hy: 'Բազրիքներ', ru: 'Подлокотники', en: 'Armrests' },
  stackable: { hy: 'Շարվող', ru: 'Штабелируемый', en: 'Stackable' },
  kitchenLength: { hy: 'Կոմպոզիցիայի երկարություն', ru: 'Длина композиции', en: 'Composition length' },
  facadeType: { hy: 'Ֆասադի տեսակ', ru: 'Тип фасада', en: 'Facade type' },
  bodyMaterial: { hy: 'Կորպուսի նյութ', ru: 'Материал корпуса', en: 'Carcass material' },
  countertopMaterial: { hy: 'Սեղանասալի նյութ', ru: 'Материал столешницы', en: 'Countertop material' },
  configuration: { hy: 'Կոնֆիգուրացիա', ru: 'Конфигурация', en: 'Layout' },
  madeToMeasure: { hy: 'Պատրաստում ըստ չափսի', ru: 'Изготовление под размер', en: 'Made to measure' },
  builtInAppliances: { hy: 'Ներկառուցվող տեխնիկա', ru: 'Встраиваемая техника', en: 'Built-in appliances' },
  doorHeight: { hy: 'Դռան բարձրություն', ru: 'Высота полотна', en: 'Door height' },
  doorWidth: { hy: 'Դռան լայնություն', ru: 'Ширина полотна', en: 'Door width' },
  doorThickness: { hy: 'Դռան հաստություն', ru: 'Толщина полотна', en: 'Door thickness' },
  coating: { hy: 'Ծածկույթ', ru: 'Покрытие', en: 'Finish' },
  openingType: { hy: 'Բացման տեսակ', ru: 'Тип открывания', en: 'Opening type' },
  openingSide: { hy: 'Բացման ուղղություն', ru: 'Сторона открывания', en: 'Opening side' },
  frameIncluded: { hy: 'Կոմպլեկտում` շրջանակ', ru: 'Коробка в комплекте', en: 'Frame included' },
  casingIncluded: { hy: 'Կոմպլեկտում` նալիչնիկ', ru: 'Наличники в комплекте', en: 'Casing included' },
  hardware: { hy: 'Ֆուռնիտուրա', ru: 'Фурнитура', en: 'Hardware' },
  installationPrice: { hy: 'Տեղադրման արժեք', ru: 'Стоимость установки', en: 'Installation price' },
  soundInsulation: { hy: 'Ձայնամեկուսացում', ru: 'Шумоизоляция', en: 'Sound insulation' },
  lockClass: { hy: 'Կողպեքի դաս', ru: 'Класс замка', en: 'Lock class' },
  ageGroup: { hy: 'Տարիքային խումբ', ru: 'Возрастная группа', en: 'Age group' },
  adjustableHeight: { hy: 'Կարգավորվող բարձրություն', ru: 'Регулируемая высота', en: 'Height adjustable' },
  cableManagement: { hy: 'Մալուխների անցք', ru: 'Кабель-менеджмент', en: 'Cable management' },
  assemblyRequired: { hy: 'Պահանջվում է հավաքում', ru: 'Требуется сборка', en: 'Assembly required' },
};

/**
 * Enumerated specification values, namespaced as `<specKey>.<valueKey>`.
 * Numeric and free-form values (e.g. "1600 × 2000 мм") are stored as-is.
 */
export const SPEC_VALUES: Record<string, LocalizedLabel> = {
  'mechanism.eurobook': { hy: 'Եվրոգիրք', ru: 'Еврокнижка', en: 'Eurobook' },
  'mechanism.dolphin': { hy: 'Դելֆին', ru: 'Дельфин', en: 'Dolphin' },
  'mechanism.accordion': { hy: 'Ակորդեոն', ru: 'Аккордеон', en: 'Accordion' },
  'mechanism.clickclack': { hy: 'Կլիկ-կլյակ', ru: 'Клик-кляк', en: 'Click-clack' },
  'mechanism.pantograph': { hy: 'Պանտոգրաֆ', ru: 'Пантограф', en: 'Pantograph' },
  'mechanism.rollout': { hy: 'Դուրս քաշվող', ru: 'Выкатной', en: 'Roll-out' },
  'mechanism.none': { hy: 'Առանց մեխանիզմի', ru: 'Без механизма', en: 'Non-convertible' },
  'filler.hrFoam': { hy: 'HR փրփուր', ru: 'ППУ высокой упругости', en: 'High-resilience foam' },
  'filler.springBonnell': { hy: 'Bonnell զսպանակներ', ru: 'Пружины Bonnell', en: 'Bonnell springs' },
  'filler.pocketSpring': { hy: 'Անկախ զսպանակներ', ru: 'Независимые пружины', en: 'Pocket springs' },
  'filler.holofiber': { hy: 'Հոլոֆայբեր', ru: 'Холлофайбер', en: 'Hollow fibre' },
  'filler.latex': { hy: 'Բնական լատեքս', ru: 'Натуральный латекс', en: 'Natural latex' },
  'filler.memoryFoam': { hy: 'Memory foam', ru: 'Memory foam', en: 'Memory foam' },
  'cornerSide.left': { hy: 'Ձախ', ru: 'Левый', en: 'Left' },
  'cornerSide.right': { hy: 'Աջ', ru: 'Правый', en: 'Right' },
  'cornerSide.universal': { hy: 'Ունիվերսալ', ru: 'Универсальный', en: 'Reversible' },
  'baseType.slats': { hy: 'Օրթոպեդիկ լաթեր', ru: 'Ортопедическое основание', en: 'Slatted base' },
  'baseType.solid': { hy: 'Ամբողջական հիմք', ru: 'Сплошное основание', en: 'Solid base' },
  'baseType.none': { hy: 'Առանց հիմքի', ru: 'Без основания', en: 'Without base' },
  'rigidity.soft': { hy: 'Փափուկ', ru: 'Мягкий', en: 'Soft' },
  'rigidity.medium': { hy: 'Միջին', ru: 'Средний', en: 'Medium' },
  'rigidity.firm': { hy: 'Կոշտ', ru: 'Жёсткий', en: 'Firm' },
  'springType.pocket': { hy: 'Անկախ զսպանակային բլոկ', ru: 'Независимый пружинный блок', en: 'Pocket spring unit' },
  'springType.bonnell': { hy: 'Կախյալ զսպանակներ', ru: 'Зависимые пружины', en: 'Bonnell unit' },
  'springType.springless': { hy: 'Առանց զսպանակների', ru: 'Беспружинный', en: 'Springless' },
  'tableShape.rectangular': { hy: 'Ուղղանկյուն', ru: 'Прямоугольный', en: 'Rectangular' },
  'tableShape.round': { hy: 'Կլոր', ru: 'Круглый', en: 'Round' },
  'tableShape.oval': { hy: 'Օվալ', ru: 'Овальный', en: 'Oval' },
  'tableShape.square': { hy: 'Քառակուսի', ru: 'Квадратный', en: 'Square' },
  'facadeType.matteLacquer': { hy: 'Մատ լաք', ru: 'Матовая эмаль', en: 'Matte lacquer' },
  'facadeType.glossLacquer': { hy: 'Փայլուն լաք', ru: 'Глянцевая эмаль', en: 'Gloss lacquer' },
  'facadeType.veneer': { hy: 'Սպոն', ru: 'Шпон', en: 'Veneer' },
  'facadeType.plasticHpl': { hy: 'HPL պլաստիկ', ru: 'Пластик HPL', en: 'HPL plastic' },
  'facadeType.frameMdf': { hy: 'Շրջանակային ՄԴՖ', ru: 'Рамочный МДФ', en: 'Framed MDF' },
  'configuration.straight': { hy: 'Ուղիղ', ru: 'Прямая', en: 'Straight' },
  'configuration.lShaped': { hy: 'Г-աձև', ru: 'Г-образная', en: 'L-shaped' },
  'configuration.uShaped': { hy: 'П-աձև', ru: 'П-образная', en: 'U-shaped' },
  'configuration.island': { hy: 'Կղզյակով', ru: 'С островом', en: 'With island' },
  'coating.enamel': { hy: 'Էմալ', ru: 'Эмаль', en: 'Enamel' },
  'coating.veneer': { hy: 'Բնական սպոն', ru: 'Натуральный шпон', en: 'Natural veneer' },
  'coating.ecoVeneer': { hy: 'Էկո-սպոն', ru: 'Экошпон', en: 'Eco-veneer' },
  'coating.pvc': { hy: 'PVC թաղանթ', ru: 'ПВХ-плёнка', en: 'PVC film' },
  'coating.laminate': { hy: 'Լամինատ', ru: 'Ламинат', en: 'Laminate' },
  'coating.powderPaint': { hy: 'Փոշեներկ', ru: 'Порошковая краска', en: 'Powder coating' },
  'openingType.swing': { hy: 'Ծխնիներով', ru: 'Распашная', en: 'Swing' },
  'openingType.sliding': { hy: 'Սահող', ru: 'Раздвижная', en: 'Sliding' },
  'openingType.hidden': { hy: 'Թաքնված', ru: 'Скрытая', en: 'Hidden' },
  'openingType.folding': { hy: 'Ծալովի', ru: 'Складная', en: 'Folding' },
  'openingSide.left': { hy: 'Ձախ', ru: 'Левое', en: 'Left-hand' },
  'openingSide.right': { hy: 'Աջ', ru: 'Правое', en: 'Right-hand' },
  'openingSide.universal': { hy: 'Ունիվերսալ', ru: 'Универсальное', en: 'Reversible' },
  'headboard.upholstered': { hy: 'Փափուկ', ru: 'Мягкое', en: 'Upholstered' },
  'headboard.wooden': { hy: 'Փայտե', ru: 'Деревянное', en: 'Wooden' },
  'headboard.none': { hy: 'Առանց գլխամասի', ru: 'Без изголовья', en: 'None' },
  'ageGroup.toddler': { hy: '1–4 տարեկան', ru: '1–4 года', en: '1–4 years' },
  'ageGroup.child': { hy: '4–10 տարեկան', ru: '4–10 лет', en: '4–10 years' },
  'ageGroup.teen': { hy: '10+ տարեկան', ru: '10+ лет', en: '10+ years' },
  'hardware.basic': { hy: 'Ստանդարտ', ru: 'Стандартная', en: 'Standard' },
  'hardware.soft': { hy: 'Doerner-ով', ru: 'С доводчиками', en: 'Soft-close' },
  'hardware.premium': { hy: 'Պրեմիում', ru: 'Премиальная', en: 'Premium' },
  'yes': { hy: 'Այո', ru: 'Есть', en: 'Yes' },
  'no': { hy: 'Ոչ', ru: 'Нет', en: 'No' },
};

export type AttributeLocale = keyof LocalizedLabel;

export const labelOf = (dictionary: Record<string, LocalizedLabel>, key: string, locale: AttributeLocale): string =>
  dictionary[key]?.[locale] ?? key;

export const colorLabel = (key: string, locale: AttributeLocale): string =>
  COLORS[key]?.label[locale] ?? key;

export const materialLabel = (key: string, locale: AttributeLocale): string =>
  MATERIALS[key]?.label[locale] ?? key;

export const specLabel = (key: string, locale: AttributeLocale): string =>
  SPEC_LABELS[key]?.[locale] ?? key;

/**
 * Renders a spec value: enumerated keys go through the dictionary, booleans
 * become да/нет, everything else (sizes, numbers with units) is already text.
 */
export const specValueLabel = (
  specKey: string,
  value: string | number | boolean,
  locale: AttributeLocale,
): string => {
  if (typeof value === 'boolean') return SPEC_VALUES[value ? 'yes' : 'no']![locale];
  if (typeof value === 'number') return String(value);
  const namespaced = SPEC_VALUES[`${specKey}.${value}`];
  if (namespaced) return namespaced[locale];
  const bare = SPEC_VALUES[value];
  return bare ? bare[locale] : value;
};
