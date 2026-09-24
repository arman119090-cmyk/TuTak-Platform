/**
 * Данные компании и флаги показа секций.
 *
 * Правило: всё, что не подтверждено заказчиком, либо `null` (и тогда на сайте
 * не показывается вовсе), либо видимый плейсхолдер в квадратных скобках.
 * Список того, что ждём от заказчика, — в README → «Что нужно от заказчика».
 */

export const company = {
  brand: 'ElGo',
  legalName: {
    hy: '«ԷԼԳՕ» ՍՊԸ',
    ru: 'ООО «ԷԼԳՕ»',
    en: 'ElGo LLC',
  },
  director: {
    hy: 'Արսեն Իսկանդարյան',
    ru: 'Арсен Искандарян',
    en: 'Arsen Iskandaryan',
  },
  address: {
    hy: 'Երևան, Նորք-Մարաշ, Նորք 2-րդ նրբանցք, 76',
    ru: 'Ереван, Норк-Мараш, 2-й переулок Норк, 76',
    en: '76 Nork 2nd Lane, Nork-Marash, Yerevan',
  },
  // Для schema.org — структурно.
  postal: {
    streetAddress: '76 Nork 2nd Lane',
    addressLocality: 'Yerevan',
    addressRegion: 'Nork-Marash',
    addressCountry: 'AM',
  },
  phone: '+374 43 357 007',
  phoneHref: 'tel:+37443357007',

  // Плейсхолдер: почта на домене ещё не заведена. Пока `emailConfirmed`
  // false, адрес показывается в квадратных скобках и без ссылки mailto.
  email: 'info@elgo.am',
  emailConfirmed: false,

  // Гос. регистрация — дана заказчиком, публикуется.
  registration: {
    number: '273.110.1441879',
    date: '27.02.2025',
  },

  // ՀՎՀՀ: в исходных данных 6 цифр вместо 8. НЕ публикуется, пока не
  // подтверждён. Когда придёт — вписать строкой, секция покажет сама.
  taxId: null as string | null,

  // Номер лицензии: плейсхолдер. Пока null — на сайте не показывается.
  license: null as string | null,

  // НОМЕР БАНКОВСКОГО СЧЁТА НА САЙТ НЕ ДОБАВЛЯТЬ — см. BRIEF.md, п. 2.
} as const;

export const flags = {
  // Секция «Цифры»: пока нет реальных значений — не показывается.
  showStats: false,
  // Ссылка «Все проекты →»: этап 2.
  showAllProjectsLink: false,
  // Кнопка мессенджера в углу на телефоне: заказчик ещё не выбрал.
  // Варианты: null | { kind: 'whatsapp', number: '37443357007' }
  //         | { kind: 'telegram', username: 'elgo_am' }
  messenger: null as
    | null
    | { kind: 'whatsapp'; number: string }
    | { kind: 'telegram'; username: string },
};

/**
 * Цифры для секции «Цифры». Значения — только реальные, от заказчика.
 * Показываются, только если flags.showStats === true.
 */
export const stats = [
  { key: 'objects', value: '[N]' },
  { key: 'area', value: '[N]' },
  { key: 'machinery', value: '[N]' },
  { key: 'staff', value: '[N]' },
] as const;
