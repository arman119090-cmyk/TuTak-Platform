import type { LocalizedLabel } from './attributes';

/**
 * Editorial and legal pages.
 *
 * Everything here is demonstration copy for a fictional shop. The pages that
 * would carry legal weight in a real store (privacy, terms, public offer) are
 * flagged `legal: true` and render a visible disclaimer — a demo must not look
 * like it is making binding promises.
 */

export type ContentSection = { heading: LocalizedLabel; body: LocalizedLabel[] };

export type ContentPage = {
  slug: string;
  group: 'company' | 'help' | 'legal';
  title: LocalizedLabel;
  intro: LocalizedLabel;
  legal?: boolean;
  sections: ContentSection[];
};

const s = (
  heading: LocalizedLabel,
  ...body: LocalizedLabel[]
): ContentSection => ({ heading, body });

export const CONTENT_PAGES: ContentPage[] = [
  {
    slug: 'about',
    group: 'company',
    title: { hy: 'Մեր մասին', ru: 'О компании', en: 'About us' },
    intro: {
      hy: 'Մենք կահույքի խանութ ենք Երևանում՝ սեփական արտադրամասով և առաքման ծառայությամբ։',
      ru: 'Мы — мебельный магазин в Ереване с собственным производством мягкой мебели и службой доставки.',
      en: 'We are a Yerevan furniture retailer with our own upholstery workshop and delivery service.',
    },
    sections: [
      s(
        { hy: 'Ինչպես սկսեցինք', ru: 'Как мы начинали', en: 'How we started' },
        {
          hy: 'Առաջին արտադրամասը բացվեց 2009 թվականին՝ հինգ վարպետով։ Այսօր թիմում 60 մարդ է, իսկ շոուրումը՝ 1 200 մ²։',
          ru: 'Первый цех открылся в 2009 году силами пяти мастеров. Сегодня в команде 60 человек, а шоурум занимает 1 200 м².',
          en: 'The first workshop opened in 2009 with five craftsmen. Today the team is 60 people and the showroom covers 1,200 m².',
        },
      ),
      s(
        { hy: 'Ինչու մեզ մոտ', ru: 'Почему у нас', en: 'Why buy here' },
        {
          hy: 'Մենք չենք վաճառում այն, ինչ ինքներս չէինք դնի տանը։ Ամեն մոդել անցնում է բեռնվածության ստուգում, իսկ ֆուռնիտուրան գնում ենք ուղիղ գործարանից։',
          ru: 'Мы не продаём то, что не поставили бы себе домой. Каждая модель проходит проверку на нагрузку, а фурнитуру закупаем напрямую у фабрик.',
          en: 'We do not sell what we would not put in our own homes. Every model is load-tested and the hardware comes straight from the factories.',
        },
      ),
      s(
        { hy: 'Սերվիս գնումից հետո', ru: 'Сервис после покупки', en: 'Service after the sale' },
        {
          hy: 'Երաշխիքային ժամկետից հետո էլ կարող եք պատվիրել պահեստամասեր և վերանորոգում։',
          ru: 'Даже после гарантии вы можете заказать запчасти и ремонт — сервисный отдел работает для всех покупателей.',
          en: 'Spare parts and repairs stay available after the warranty ends — the service desk works for every customer.',
        },
      ),
    ],
  },
  {
    slug: 'delivery',
    group: 'help',
    title: { hy: 'Առաքում', ru: 'Доставка', en: 'Delivery' },
    intro: {
      hy: 'Առաքում ամբողջ Հայաստանում՝ Երևանում հաջորդ օրը, մարզերում՝ 2–4 օրում։',
      ru: 'Доставляем по всей Армении: Ереван — на следующий день, регионы — за 2–4 дня.',
      en: 'We deliver across Armenia: next day in Yerevan, two to four days to the regions.',
    },
    sections: [
      s(
        { hy: 'Արժեքը', ru: 'Стоимость', en: 'Pricing' },
        {
          hy: 'Երևան՝ 5 000 ֏, մարզեր՝ 9 000–22 000 ֏՝ կախված հեռավորությունից։ 400 000 ֏-ից ավելի պատվերների առաքումն անվճար է։',
          ru: 'Ереван — 5 000 ֏, регионы — от 9 000 до 22 000 ֏ в зависимости от расстояния. Заказы от 400 000 ֏ доставляем бесплатно.',
          en: 'Yerevan is 5,000 ֏; the regions range from 9,000 to 22,000 ֏ by distance. Orders above 400,000 ֏ ship free.',
        },
      ),
      s(
        { hy: 'Հարկ բարձրացնելը', ru: 'Подъём на этаж', en: 'Carrying up' },
        {
          hy: 'Վերելակով՝ 4 000 ֏։ Առանց վերելակի՝ լրացուցիչ 1 000 ֏ յուրաքանչյուր հարկի համար։',
          ru: 'С лифтом — 4 000 ֏. Без лифта — плюс 1 000 ֏ за каждый этаж.',
          en: 'With a lift, 4,000 ֏. Without one, an extra 1,000 ֏ per floor.',
        },
      ),
      s(
        { hy: 'Ինքնավերցում', ru: 'Самовывоз', en: 'Pickup' },
        {
          hy: 'Անվճար՝ երկու կետից՝ Մաշտոցի 42 և Բագրատունյաց 12։ Պատվերը պահում ենք 5 օր։',
          ru: 'Бесплатно из двух точек: Маштоца 42 и Багратуняц 12. Заказ храним 5 дней.',
          en: 'Free from two points: Mashtots 42 and Bagratunyats 12. We hold the order for five days.',
        },
      ),
    ],
  },
  {
    slug: 'payment',
    group: 'help',
    title: { hy: 'Վճարում', ru: 'Оплата', en: 'Payment' },
    intro: {
      hy: 'Վճարեք քարտով կայքում, կանխիկ շոուրումում կամ առաքման պահին։',
      ru: 'Оплатить можно картой на сайте, наличными в шоуруме или при доставке.',
      en: 'Pay by card on the site, in cash in the showroom, or on delivery.',
    },
    sections: [
      s(
        { hy: 'Քարտով վճարում', ru: 'Оплата картой', en: 'Card payment' },
        {
          hy: 'ՈՒՇԱԴՐՈՒԹՅՈՒՆ. այս դեմո-կայքում վճարումը մոդելավորված է։ Իրական գումար չի գանձվում, բանկային ինտեգրացիա միացված չէ։',
          ru: 'Важно: в этом демо оплата имитируется. Реальные деньги не списываются, банковская интеграция не подключена.',
          en: 'Note: payment in this demo is simulated. No real money moves and no bank integration is connected.',
        },
      ),
      s(
        { hy: 'Ապառիկ', ru: 'Рассрочка', en: 'Instalments' },
        {
          hy: 'Իրական խանութում ապառիկը ձևակերպվում է գործընկեր բանկերի միջոցով՝ մինչև 12 ամիս։ Դեմոյում սա ցուցադրական տեքստ է։',
          ru: 'В реальном магазине рассрочка оформляется через банки-партнёры на срок до 12 месяцев. В демо это демонстрационный текст.',
          en: 'In a real shop, instalments run through partner banks for up to 12 months. Here this is demo copy.',
        },
      ),
    ],
  },
  {
    slug: 'warranty',
    group: 'help',
    title: { hy: 'Երաշխիք', ru: 'Гарантия', en: 'Warranty' },
    intro: {
      hy: 'Երաշխիքը՝ 24–60 ամիս՝ կախված կատեգորիայից։',
      ru: 'Гарантия от 24 до 60 месяцев в зависимости от категории товара.',
      en: 'Warranty runs from 24 to 60 months depending on the category.',
    },
    legal: true,
    sections: [
      s(
        { hy: 'Ինչ է ծածկում', ru: 'Что покрывает', en: 'What is covered' },
        {
          hy: 'Կմախք, մեխանիզմներ, ֆուռնիտուրա և արտադրական թերություններ։',
          ru: 'Каркас, механизмы, фурнитуру и производственные дефекты.',
          en: 'Frames, mechanisms, hardware and manufacturing defects.',
        },
      ),
      s(
        { hy: 'Ինչ չի ծածկում', ru: 'Что не покрывает', en: 'What is not covered' },
        {
          hy: 'Բնական մաշվածություն, սխալ շահագործում, ինքնուրույն վերանորոգման փորձեր։',
          ru: 'Естественный износ, нарушение правил эксплуатации, самостоятельный ремонт.',
          en: 'Normal wear, misuse, and repairs attempted by the customer.',
        },
      ),
    ],
  },
  {
    slug: 'returns',
    group: 'help',
    title: { hy: 'Վերադարձ', ru: 'Возврат', en: 'Returns' },
    intro: {
      hy: '14 օր՝ ապրանքը վերադարձնելու համար, եթե այն չի օգտագործվել։',
      ru: '14 дней на возврат, если товар не был в использовании и сохранён товарный вид.',
      en: 'Fourteen days to return an unused item in its original condition.',
    },
    legal: true,
    sections: [
      s(
        { hy: 'Ինչպես վերադարձնել', ru: 'Как вернуть', en: 'How to return' },
        {
          hy: 'Գրեք մեզ, նշեք պատվերի համարը և պատճառը։ Կհամաձայնեցնենք վերցնելու օրը։',
          ru: 'Напишите нам, укажите номер заказа и причину. Согласуем день, когда заберём товар.',
          en: 'Write to us with the order number and the reason; we agree a collection day.',
        },
      ),
      s(
        { hy: 'Բացառություններ', ru: 'Исключения', en: 'Exceptions' },
        {
          hy: 'Անհատական չափսերով պատրաստված կահույքը վերադարձի ենթակա չէ, բացի թերության դեպքից։',
          ru: 'Мебель, изготовленная по индивидуальным размерам, возврату не подлежит — кроме случаев брака.',
          en: 'Made-to-measure furniture cannot be returned unless it is faulty.',
        },
      ),
    ],
  },
  {
    slug: 'assembly',
    group: 'help',
    title: { hy: 'Հավաքում', ru: 'Сборка', en: 'Assembly' },
    intro: {
      hy: 'Մեր բրիգադը հավաքում է կահույքը և տանում փաթեթավորումը։',
      ru: 'Наша бригада собирает мебель и увозит упаковку.',
      en: 'Our crew assembles the furniture and takes the packaging away.',
    },
    sections: [
      s(
        { hy: 'Արժեքը', ru: 'Стоимость', en: 'Pricing' },
        {
          hy: '12 000 ֏ կահույքի մեկ միավորի համար, դռան տեղադրումը՝ 25 000 ֏։',
          ru: '12 000 ֏ за единицу мебели, установка двери — 25 000 ֏.',
          en: '12,000 ֏ per furniture unit; door installation is 25,000 ֏.',
        },
      ),
      s(
        { hy: 'Ժամկետները', ru: 'Сроки', en: 'Timing' },
        {
          hy: 'Սովորաբար հավաքումը տևում է 40 րոպեից մինչև 3 ժամ՝ կախված մոդելից։',
          ru: 'Обычно сборка занимает от 40 минут до 3 часов в зависимости от модели.',
          en: 'Assembly usually takes from 40 minutes to three hours depending on the model.',
        },
      ),
    ],
  },
  {
    slug: 'measurement',
    group: 'help',
    title: { hy: 'Չափագրում', ru: 'Замер', en: 'Measurement' },
    intro: {
      hy: 'Անվճար չափագրում խոհանոցների, պահարանների և դռների համար։',
      ru: 'Бесплатный замер для кухонь, шкафов и дверей.',
      en: 'Free measurement for kitchens, wardrobes and doors.',
    },
    sections: [
      s(
        { hy: 'Ինչպես է անցնում', ru: 'Как проходит', en: 'How it works' },
        {
          hy: 'Չափագրողը գալիս է ձեզ հարմար ժամին, չափում է և նույն օրը փոխանցում տվյալները դիզայներին։',
          ru: 'Замерщик приезжает в удобное время, снимает размеры и в тот же день передаёт данные дизайнеру.',
          en: 'The surveyor visits at a time that suits you and passes the measurements to a designer the same day.',
        },
      ),
    ],
  },
  {
    slug: 'contacts',
    group: 'company',
    title: { hy: 'Կոնտակտներ', ru: 'Контакты', en: 'Contacts' },
    intro: {
      hy: 'Շոուրում Երևանում, առաքում ամբողջ Հայաստանում։',
      ru: 'Шоурум в Ереване, доставка по всей Армении.',
      en: 'Showroom in Yerevan, delivery across Armenia.',
    },
    sections: [
      s(
        { hy: 'Շոուրում', ru: 'Шоурум', en: 'Showroom' },
        {
          hy: 'Երևան, Մաշտոցի պող. 42։ Երկ–Ուրբ 10:00–20:00, Շաբ–Կիր 11:00–18:00։',
          ru: 'Ереван, пр. Маштоца 42. Пн–Пт 10:00–20:00, Сб–Вс 11:00–18:00.',
          en: 'Yerevan, 42 Mashtots Ave. Mon–Fri 10:00–20:00, Sat–Sun 11:00–18:00.',
        },
      ),
      s(
        { hy: 'Կապ', ru: 'Связь', en: 'Get in touch' },
        {
          hy: 'Հեռախոս և WhatsApp՝ +374 10 000 000։ Էլ. փոստ՝ hello@ornata.demo։ Այս կոնտակտները ցուցադրական են։',
          ru: 'Телефон и WhatsApp: +374 10 000 000. Почта: hello@ornata.demo. Контакты демонстрационные.',
          en: 'Phone and WhatsApp: +374 10 000 000. E-mail: hello@ornata.demo. These contacts are fictional.',
        },
      ),
    ],
  },
  {
    slug: 'faq',
    group: 'help',
    title: { hy: 'Հաճախ տրվող հարցեր', ru: 'Частые вопросы', en: 'FAQ' },
    intro: {
      hy: 'Այն, ինչ հաճախ են հարցնում գնորդները։',
      ru: 'То, о чём чаще всего спрашивают покупатели.',
      en: 'The questions customers ask most often.',
    },
    sections: [
      s(
        { hy: 'Որքա՞ն է տևում պատրաստումը', ru: 'Сколько ждать изготовления', en: 'How long is production' },
        {
          hy: 'Պահեստի ապրանքները՝ 2–3 օր։ Պատվերով՝ 7–45 օր՝ նշված է ապրանքի էջում։',
          ru: 'Товары со склада — 2–3 дня. Под заказ — от 7 до 45 дней, срок указан в карточке товара.',
          en: 'Stocked items ship in two to three days. Made-to-order runs 7 to 45 days, shown on the product page.',
        },
      ),
      s(
        { hy: 'Կարո՞ղ եմ փոխել չափսերը', ru: 'Можно ли изменить размеры', en: 'Can dimensions be changed' },
        {
          hy: 'Այո, պահարանների, խոհանոցների և դռների համար։ Ուղարկեք հայտ «Անհատական չափսեր» ձևով։',
          ru: 'Да, для шкафов, кухонь и дверей. Отправьте заявку через форму «Индивидуальные размеры».',
          en: 'Yes, for wardrobes, kitchens and doors. Send a request through the custom-size form.',
        },
      ),
      s(
        { hy: 'Ինչպե՞ս ստուգել պատվերը', ru: 'Как отследить заказ', en: 'How do I track an order' },
        {
          hy: 'Անձնական էջի «Իմ պատվերները» բաժնում երևում է կարգավիճակների ամբողջ պատմությունը։',
          ru: 'В разделе «Мои заказы» личного кабинета видна вся история статусов.',
          en: 'The “My orders” section of your account shows the full status history.',
        },
      ),
    ],
  },
  {
    slug: 'privacy',
    group: 'legal',
    title: { hy: 'Գաղտնիության քաղաքականություն', ru: 'Политика конфиденциальности', en: 'Privacy policy' },
    intro: {
      hy: 'Ինչ տվյալներ ենք հավաքում և ինչու։',
      ru: 'Какие данные мы собираем и зачем.',
      en: 'What data we collect and why.',
    },
    legal: true,
    sections: [
      s(
        { hy: 'Տվյալներ', ru: 'Данные', en: 'Data' },
        {
          hy: 'Պատվերը ձևակերպելու համար՝ անուն, հեռախոս, էլ. փոստ և առաքման հասցե։',
          ru: 'Для оформления заказа: имя, телефон, e-mail и адрес доставки.',
          en: 'To process an order: name, phone, e-mail and delivery address.',
        },
      ),
      s(
        { hy: 'Cookie', ru: 'Cookie', en: 'Cookies' },
        {
          hy: 'Օգտագործում ենք լեզվի ընտրությունը և մուտքի սեսիան պահելու համար։',
          ru: 'Используем, чтобы запомнить выбранный язык и сессию входа.',
          en: 'Used to remember the chosen language and the sign-in session.',
        },
      ),
    ],
  },
  {
    slug: 'terms',
    group: 'legal',
    title: { hy: 'Օգտագործման պայմաններ', ru: 'Условия использования', en: 'Terms of use' },
    intro: {
      hy: 'Կայքից օգտվելու կանոնները։',
      ru: 'Правила пользования сайтом.',
      en: 'The rules for using this site.',
    },
    legal: true,
    sections: [
      s(
        { hy: 'Կայքի բովանդակությունը', ru: 'Содержимое сайта', en: 'Site content' },
        {
          hy: 'Բոլոր ապրանքները, գները և տեքստերը ցուցադրական են և ստեղծված են դեմոյի համար։',
          ru: 'Все товары, цены и тексты демонстрационные и созданы для показа возможностей витрины.',
          en: 'All products, prices and texts are demonstration content created for this showcase.',
        },
      ),
    ],
  },
  {
    slug: 'offer',
    group: 'legal',
    title: { hy: 'Հրապարակային օֆերտա', ru: 'Публичная оферта', en: 'Public offer' },
    intro: {
      hy: 'Առուվաճառքի պայմանների ցուցադրական տարբերակ։',
      ru: 'Демонстрационная версия условий купли-продажи.',
      en: 'A demonstration version of the sale terms.',
    },
    legal: true,
    sections: [
      s(
        { hy: 'Կարգավիճակ', ru: 'Статус документа', en: 'Status of this document' },
        {
          hy: 'Սա օֆերտա չէ և իրավական ուժ չունի։ Իրական գործարկման դեպքում տեքստը պետք է պատրաստի իրավաբանը։',
          ru: 'Этот текст не является офертой и не имеет юридической силы. Для реального запуска его должен подготовить юрист.',
          en: 'This text is not an offer and carries no legal force. A real launch needs a lawyer-drafted version.',
        },
      ),
      s(
        { hy: 'Պատվերի ձևակերպում', ru: 'Оформление заказа', en: 'Placing an order' },
        {
          hy: 'Պատվերը համարվում է ընդունված մենեջերի հաստատումից հետո։',
          ru: 'Заказ считается принятым после подтверждения менеджером.',
          en: 'An order is accepted once a manager has confirmed it.',
        },
      ),
    ],
  },
];

export const getContentPage = (slug: string): ContentPage | undefined =>
  CONTENT_PAGES.find((page) => page.slug === slug);
