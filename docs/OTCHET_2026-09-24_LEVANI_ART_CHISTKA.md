# Отчёт: финальная чистка текстов LEVANI ART — 24.09.2026

## 1. Задание

Владелец проверил production и нашёл расхождения с отчётом о деплое.
Исправить прямо в production, на всех 6 языках:
1. убрать упоминания несуществующей формы запроса (в футере —
   «свяжитесь через Instagram» со ссылкой на `https://instagram.com/levani__art`);
2. Privacy Notice не должен утверждать сбор данных, которого нет;
   `LEGAL REVIEW REQUIRED` оставить;
3. убрать «Art Advisor», заменить на «Make a Private Enquiry» с переходом
   на Instagram или enquire;
4. не обещать неподтверждённые услуги (установка, доставка, консультации
   и т. п.);
5. дизайн, гербы, языки, каталог, static export, картинки, Render, «Price on
   request», SEO и URL не менять.

Затем production build, push, дождаться Render, проверить именно
https://levani-art.onrender.com на всех 6 языках и отдельным поиском
убедиться, что на публичных страницах больше нет текста про форму.

## 2. База

- Ветка: `claude/new-session-xjpidi`
- Базовый коммит: `9035375`

## 3. Исправленные тексты (все 6 языков)

| Где | Было (en) | Стало (en) |
|---|---|---|
| Футер, «Contact» | Contact details will be published shortly. Meanwhile, please use the enquiry form. | Contact details will be published shortly. For now, please contact us through **Instagram** (ссылка на `https://instagram.com/levani__art`, в новой вкладке) |
| Privacy Notice | Information you send through the enquiry form — your name, contact details, country and message — is used only to reply to your enquiry. | This website has no forms and does not ask for your personal data. It stores one cookie, LEVANI_LOCALE, only to remember the language you choose. If you write to us on Instagram, your message is handled by Instagram under its own privacy policy. The site is hosted by Render, which may keep standard technical request logs. |
| Главная, блок Private clients, кнопка | Speak with an Art Advisor → /private-clients | Make a Private Enquiry → /enquire (Instagram) |
| Private Clients, кнопка (×2) | Speak with an Art Advisor | Make a Private Enquiry → /enquire |
| Карточка крупного объекта (скульптура, фонтаны) | For large objects we discuss placement, access and installation before anything is arranged. Ask us about the setting you have in mind. | Further details about the work are available on request. (дубль этой фразы в правой панели на этих страницах убран) |
| «View in an Interior» | Interior previews for this work are in preparation… / кнопка «Ask for an interior preview» | No interior views of this work are available yet. The photograph shown is the original, unaltered. / кнопка «Enquire via Instagram» |
| /enquire, вступление | Tell us what you are looking for. We reply personally. | Tell us what you are looking for. |
| /enquire, текст Instagram | …Send us a direct message — we reply personally. | For now, enquiries are received through our Instagram account. Please send us a direct message there. |
| meta description /enquire | Enquire about a piece or arrange a private viewing. | Enquire about a piece from the collection. |
| Словари (не выводились) | errors.notConfigured «…this form will be enabled shortly» | удалено |

Ссылка Instagram во всём сайте приведена к `https://instagram.com/levani__art`,
как в задании (раньше была `https://www.instagram.com/levani__art/` — тот же
аккаунт).

`LEGAL REVIEW REQUIRED` остался в исходниках privacy/terms и в разделе `legal`
всех словарей.

## 4. Что НЕ менялось и почему

- Дизайн, гербы, 6 языков, каталог, static export, image pipeline, Render,
  «Price on request», SEO, URL — без изменений.
- **Строки advisory-услуг** (sourcing, placement, delivery coordination…)
  остались в словарях, но на сайте **не выводятся**: секция выключена в
  `src/content/site.ts` ещё с первой версии. Поиск по собранному сайту это
  подтверждает.
- «Private collectors… enquiries are handled personally and discreetly» на
  главной и аудитории на Private Clients оставлены: это описание того, кому
  адресован сайт, а не обещание конкретной услуги. Если нужно убрать и это —
  одна правка словаря.
- Слова «cast form» / «gegossener Form» (литая форма скульптуры) — не про
  веб-форму, оставлены.

**Собственная ошибка:** после правок я один раз смотрел только хвост вывода
e2e («60 passed») и не сразу заметил 2 упавших теста. Упали корректно: в
футере теперь две ссылки на Instagram, а тест ждал одну. Тест обновлён,
62/62.

## 5. Чем доказано

Локально (до пуша): typecheck 0, lint 0, vitest 27/27, e2e 62/62, smoke-набор
против локальной статической сборки 56/56. Поиск по всему `out/` (HTML, RSC,
JS) на фразы о форме, консультанте, установке, «в подготовке», частном показе
на всех 6 языках — **0 совпадений**; тегов `<form>` — 0.

Production — см. раздел 6.

## 6. Production

- **URL:** https://levani-art.onrender.com
- **Production commit:** `8663b2d3185f734cfdf14cf74acbf66db5c6dfa7`
- **Render:** deploy `dep-daqjjk8ae00c738ih8g0`, статус `live` с 14:56:15 UTC
  (сборка 62 с); предыдущий деплой — `deactivated`.
- **Smoke-тест публичного URL:** GitHub Actions run 36016311092, job
  107689624471, старт 14:58:00 UTC (после того как новый деплой стал live) —
  **56 passed / 0 failed за 45.5 с** (Chromium, 1440 и 390 px, все 6 языков).

Что smoke проверил на production дополнительно к прежнему набору:
- на каждом из 6 языков текст футера «…свяжитесь с нами через Instagram»
  на этом языке, со ссылкой на `https://instagram.com/levani__art` внутри;
- **каждая из 168 страниц sitemap** не содержит фраз о форме запроса,
  консультанте, установке/размещении, «в подготовке», частном показе
  (регулярное выражение на 6 языках) и не содержит тега `<form>`;
- кнопки Instagram на всех 18 карточках × 6 языков ведут на новый адрес.

**Production обновился:** новые проверки футера и текстов опираются на
тексты, которых не было в предыдущей сборке, и они прошли на публичном URL.

## 7. UNVERIFIED

- Safari и Firefox не проверялись (smoke — Chromium).
- Тексты на армянском, итальянском, немецком и французском — мои переводы,
  носитель не вычитывал.
- Юридическая корректность Privacy Notice не проверена юристом
  (`LEGAL REVIEW REQUIRED`).
