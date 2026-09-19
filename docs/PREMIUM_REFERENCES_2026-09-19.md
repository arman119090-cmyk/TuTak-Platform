# Премиальные референсы для TuTak — что взято и как применено (2026-09-19)

Задача владельца: «Ищи премиальные сайты и приложения, с которых можно взять
пример, и сделай наш таким же — красиво, гармонично, ровно, премиально».

Ниже — референсы, вытащенные из открытых разборов их дизайн-систем, семь
правил, которые они разделяют, и построчно, что из этого уже стоит в
TuTak (pass 1–3) и что нет.

## 1. Референсы

| Продукт | Что в нём премиального | Источник |
|---|---|---|
| **Revolut** | «Zero shadows» — глубина только контрастом поверхностей и воздухом; нейтральная палитра, фирменный цвет почти не используется (только штамп); крупная типографика display 500 c отрицательным трекингом, body 400 с положительным; радиусы: кнопки pill, карточки 20, поля 12; карточки — 32 pt padding, hairline-разделители, без теней | [Revolut DESIGN.md (awesome-design-md)](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/revolut/DESIGN.md), [Revolut design system tokens](https://oh-my-design.kr/design-systems/revolut), [Our top 5 design principles at Revolut](https://www.revolut.com/blog/post/our-top-5-design-principles-at-revolut/) |
| **Wise** | Один акцент (лайм) на нейтральной базе; заголовки очень тяжёлые и плотные, body 600 для акцента; «money without borders» читается за счёт масштаба цифр и воздуха, а не декора | [Wise Design System 2025 UI kit](https://www.figma.com/community/file/1550593868236678646/wise-design-system-2025-ui-kit), [Wise design system tokens](https://open-design.ai/plugins/design-system-wise/) |
| **Monzo / N26 / Nubank** | Транзакции сгруппированы по датам с логотипами мерчантов; «summary» через простые кольца/бары; 3–5 главных действий на экран, остальное — списки; тёплая минималистичная база | [Top fintech apps 2025 (Creole)](https://www.creolestudios.com/top-fintech-apps/), [Banking app UI design (Lollypop)](https://lollypop.design/blog/2026/june/banking-app-ui-design/), [Top banking apps UX (Wavespace)](https://www.wavespace.agency/blog/banking-app-ux) |
| **Airbnb (2025)** | Фотография — источник глубины: карточки без рамки и тени, радиус 14, текст под фото; одна тень на всю систему (только hover/модалки); ink #222, muted #6a6a6a, hairline #ddd; шкала 4/8/12/16/24/32 | [Airbnb DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md), [Airbnb 2025 summer release](https://news.airbnb.com/airbnb-2025-summer-release), [9to5Mac о редизайне](https://9to5mac.com/2025/05/13/airbnb-app-redesign-services-experiences-originals/) |
| **Starbucks Rewards** | Лояльность как прогресс: одна шкала, одна цифра, ясные уровни; приложение напоминает о выгоде, не кричит | [Loyalty program examples 2026](https://adjoe.io/blog/loyalty-program-examples/), [Loyalty UX checklist (Voucherify)](https://www.voucherify.io/blog/loyalty-programs-ux-and-ui-best-practices) |

## 2. Семь правил, общих для всех референсов

1. **Глубина без теней.** Контраст тонов (белый / neutral-50 / бренд) и
   воздух, а не drop-shadow. Тень — одна на систему и только там, где
   элемент действительно «над» страницей (hero, модалка).
2. **Одна поверхность на объект.** Карточка — когда есть фото или это одна
   кликабельная единица. Список строк, форма, текст — прямо на странице,
   с hairline-разделителями.
3. **Один акцент.** Бренд-цвет — на primary-кнопке, активном состоянии,
   одном hero. Всё остальное — чернила и три серых.
4. **Цифра — главный герой.** Баланс, кешбэк, сумма — крупно, tabular,
   600; подписи — caption 400. Заголовки экранов — не постеры (24, не 26+).
5. **Фото как материал.** Партнёрские карточки — фотография + scrim,
   текст рендерит приложение; никаких текстов внутри картинок.
6. **Одна семья иконок и один stroke.** Outline, 20–24 pt, одинаковый
   оптический вес; никаких цветных квадратов под иконками.
7. **Ритм.** Сетка 4 pt, секции 24/12, поля 16/12, радиусы три уровня
   (12 контролы / 16 карточки / 20 hero), pill только для чипов и аватаров.

## 3. Что из этого уже в TuTak (по проходам)

| Правило | Pass 1 | Pass 2 | Pass 3 (этот) |
|---|---|---|---|
| Глубина без теней | сняты рамка+тень с каждой карточки, glow, blur | тени только hero (md) и Spotlight-нет | ScanQr, Purchase, EV, DeleteAccount, PartnerDetail — без raised-карточек |
| Одна поверхность на объект | три тона Surface | Wallet и Settings без карточек | Notifications — строки; Referral — без «коробки в коробке»; PartnerDetail — одна карточка (обложка) |
| Один акцент | solid primary, coral-градиент убран | — | чипы категорий и коннекторов — серые, не белые с рамкой |
| Цифра — герой | balance 44, tabular | Wallet 32, inline-легенда | EvHistory — итог через токены (32/tabular), не inline 30 px |
| Фото как материал | hero c scrim | Partner Spotlight 16:10 + scrim | — |
| Одна семья иконок | Jako + outline | stroke 2.2 / outline 20–22 | убраны иконки-плитки в уведомлениях |
| Ритм | радиусы 10/14/20/24, секции 32 | 10/12/16/20, секции 24 | header: accessory не сжимает заголовок |

## 4. Чего у референсов есть, а у TuTak пока нет

- **Собственная гарнитура** (Revolut — Aeonik, Wise — Wise Sans, Airbnb —
  Cereal). TuTak на системном шрифте (SF/Roboto). Это самый заметный
  оставшийся разрыв; фирменный шрифт — решение владельца и лицензия.
- **Настоящие фотографии партнёров** в Spotlight и на обложках: сейчас
  в демо — сгенерированные градиенты с Jako; в проде — то, что загрузит
  администратор.
- **Motion**: у референсов — плавные переходы между экранами и
  «живые» цифры; у TuTak — только press-scale и анимация бара.
- **Веб-панели (admin/partner)** этим проходом не тронуты: они на
  общей `@tutak/design/web`, но их премиальность не оценивалась.
