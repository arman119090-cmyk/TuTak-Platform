import type { NotificationKind } from '@cashout/contracts';

/**
 * What the phone shows for each notification, per language. Kept in the API
 * because the push payload is built here; the app's own strings are in
 * @cashout/i18n. Placeholders: {{amount}}, {{park}}.
 */
type Text = { title: string; body: string };
type Locale = 'hy' | 'ru' | 'en';

const TEXTS: Record<NotificationKind, Record<Locale, Text>> = {
  PAYOUT_COMPLETED: {
    hy: { title: 'Գումարն ուղարկված է', body: '{{amount}} ուղարկվել է ձեր iDram-ին' },
    ru: { title: 'Деньги отправлены', body: '{{amount}} отправлено на ваш iDram' },
    en: { title: 'Money sent', body: '{{amount}} has been sent to your iDram' },
  },
  PAYOUT_CANCELLED: {
    hy: { title: 'Վճարումը չեղարկվել է', body: 'Գումարը մնաց ձեր հաշվեկշռին' },
    ru: { title: 'Выплата отменена', body: 'Деньги остались на вашем балансе' },
    en: { title: 'Payout cancelled', body: 'The money stayed on your balance' },
  },
  PAYOUT_REJECTED: {
    hy: { title: 'Վճարումը մերժվել է', body: 'Ձեր հաշվեկշիռը չի փոխվել' },
    ru: { title: 'Выплата отклонена', body: 'Ваш баланс не тронут' },
    en: { title: 'Payout rejected', body: 'Your balance has not been touched' },
  },
  PAYOUT_UNDER_REVIEW: {
    hy: { title: 'Վճարումը ստուգվում է', body: 'Աջակցությունը կկապվի ձեզ հետ' },
    ru: { title: 'Выплата на проверке', body: 'Поддержка свяжется с вами' },
    en: { title: 'Payout under review', body: 'Support will contact you' },
  },
  AUTO_PAYOUT_CREATED: {
    hy: { title: 'Ավտոմատ վճարում', body: 'Ձեր կանոնով ստեղծվել է վճարում {{amount}}' },
    ru: { title: 'Автоматическая выплата', body: 'По вашему правилу создана выплата {{amount}}' },
    en: { title: 'Automatic payout', body: 'Your rule created a payout of {{amount}}' },
  },
  AUTO_PAYOUT_PAUSED: {
    hy: { title: 'Ավտոմատ վճարումը դադարեցված է', body: 'Բացեք հավելվածը՝ պատճառը տեսնելու համար' },
    ru: { title: 'Автовыплата приостановлена', body: 'Откройте приложение, чтобы увидеть причину' },
    en: { title: 'Automatic payout paused', body: 'Open the app to see why' },
  },
  SECURITY_PIN_CHANGED: {
    hy: { title: 'PIN-ը փոխված է', body: 'Եթե դա դուք չէիք, կապվեք աջակցության հետ' },
    ru: { title: 'PIN изменён', body: 'Если это были не вы, свяжитесь с поддержкой' },
    en: { title: 'PIN changed', body: 'If this was not you, contact support' },
  },
  SECURITY_BIOMETRIC_CHANGED: {
    hy: {
      title: 'Կենսաչափության կարգավորումը փոխված է',
      body: 'Եթե դա դուք չէիք, կապվեք աջակցության հետ',
    },
    ru: {
      title: 'Настройка биометрии изменена',
      body: 'Если это были не вы, свяжитесь с поддержкой',
    },
    en: { title: 'Biometrics setting changed', body: 'If this was not you, contact support' },
  },
  SECURITY_NEW_DEVICE: {
    hy: { title: 'Մուտք նոր սարքից', body: 'Եթե դա դուք չէիք, դուրս եկեք բոլոր սարքերից' },
    ru: {
      title: 'Вход с нового устройства',
      body: 'Если это были не вы, выйдите на всех устройствах',
    },
    en: { title: 'Sign-in from a new device', body: 'If this was not you, sign out everywhere' },
  },
  PARK_SWITCHED: {
    hy: { title: 'Տաքսի պարկը փոխված է', body: 'Այժմ աշխատում եք {{park}}-ի հետ' },
    ru: { title: 'Таксопарк изменён', body: 'Теперь вы работаете с {{park}}' },
    en: { title: 'Taxi park changed', body: 'You are now working with {{park}}' },
  },
  PARK_ACCESS_CHANGED: {
    hy: { title: 'Պարկի մուտքը փոխված է', body: 'Բացեք հավելվածը մանրամասների համար' },
    ru: { title: 'Доступ к парку изменён', body: 'Откройте приложение для подробностей' },
    en: { title: 'Park access changed', body: 'Open the app for details' },
  },
  DRIVER_ID_DECIDED: {
    hy: { title: 'Driver ID-ի հայտի որոշում', body: 'Բացեք հավելվածը արդյունքը տեսնելու համար' },
    ru: {
      title: 'Решение по заявке Driver ID',
      body: 'Откройте приложение, чтобы увидеть результат',
    },
    en: { title: 'Driver ID request decided', body: 'Open the app to see the result' },
  },
};

export function notificationText(
  kind: NotificationKind,
  locale: string,
  payload: Record<string, string | number | null>,
): Text {
  const texts =
    TEXTS[kind][
      (['hy', 'ru', 'en'] as const).includes(locale as Locale) ? (locale as Locale) : 'hy'
    ];
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(payload[key] ?? ''));
  return { title: fill(texts.title), body: fill(texts.body) };
}
