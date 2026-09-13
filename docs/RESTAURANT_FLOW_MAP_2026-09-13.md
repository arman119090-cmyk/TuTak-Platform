# Ресторанный сценарий: карта состояния

Составлена чтением кода и запуском тестов, а не предположениями.
Оценка после работы этой сессии; где состояние изменилось, указано, каким
оно было.

## Звенья основной цепочки

| Звено | Было | Стало | Чем подтверждено |
|---|---|---|---|
| клиент → ресторан (поиск, карта, карточка) | **BROKEN** | READY | `restaurant-discoverability.int-spec.ts` |
| ресторан → филиал | READY | READY | `partner-branches.int-spec.ts` |
| филиал → QR | READY | READY | `partner-branch-staff-and-qr.int-spec.ts` (QR отзывается, не резолвится после отзыва, не подходит к другому филиалу) |
| QR → покупка | **PARTIAL** | READY | `restaurant-branch-attribution.int-spec.ts` |
| покупка → подтверждение сотрудником | **PARTIAL** | READY | там же + `partner-branch-staff-and-qr` |
| подтверждение → бонус клиента | READY | READY | `bonus-engine`, `restaurant-journey` |
| бонус → referral L1/L2/L3 | READY | READY | `referral-journey`, `restaurant-journey` |
| referral → Referral Challenge | READY | READY | `referral-abuse`, `restaurant-journey` (награда и её clawback) |
| всё → ledger | READY | READY | `ledger`, `money-rounding`, `restaurant-journey` (сходимость двойной записи по всем транзакциям журнея) |
| ledger → кабинет ресторана | **PARTIAL** | READY | возвраты не показывались; `restaurant-journey` |
| кабинет → возврат | READY | READY | `refund-engine`, `refund-decision-races`, `refund-dual-control`, `refund-clawback-deep` |
| возврат → reconciliation | READY | READY | `reconciliation.int-spec.ts`, админ-панель `/reconciliation` |

## Подсистемы

| Что | Оценка | Комментарий |
|---|---|---|
| Partner, PartnerApplication, approve/reject | READY | самоодобрение владельцем закрыто (403), проверено |
| Категории партнёров, ресторанная категория | READY (было BROKEN) | `restaurant` есть в списке; канонизация + CHECK |
| Филиалы, координаты | READY | |
| Владельцы, менеджеры, кассиры | READY | |
| Branch-scoped permissions | READY (было PARTIAL) | дыра была в покупке без филиала |
| QR (PartnerBranchQrCode) | READY | серверный непрозрачный токен |
| QR (legacy `TUTAK-PAY:`) | PARTIAL, намеренно | печатается только у партнёра без филиалов; после появления филиалов старый отпечатанный код перестаёт работать — это правильное поведение |
| QR (legacy `QrCode` / `POST /qr/redeem`) | PARTIAL | отдельный инвойсный поток, к ресторанному сценарию не относится, `STATIC_MERCHANT` запрещён |
| PurchaseIntent, Transaction, Wallet, BonusLot | READY | |
| Cashback, использование бонусов, потолок | READY (было PARTIAL) | потолок теперь виден клиенту до кассы |
| Возвраты (прямой, по заявке, dual control) | READY | |
| Партнёрский баланс, settlement, payout, collection | READY | |
| Reconciliation | READY | |
| AuditLog | READY | каждая запись либо с актором, либо системная с указанием транзакции-причины |
| Referral, коды, цепочка | READY | |
| PartnerOfferingItem (меню) | PARTIAL | название, описание, цена, порядок, CRUD в панели, read-only в приложении — есть; картинки позиции и скрытие позиции — нет |
| Медиа: логотип, обложка | READY | с модерацией |
| Медиа: галерея фотографий | MISSING | нет вида ассета `PARTNER_PHOTO`, нет модерации и UI |
| Рабочие часы | MISSING | колонки не существует нигде |
| Публичный телефон/контакты заведения | MISSING | то же |
| Список филиалов на странице ресторана у клиента | MISSING | страница открывается по конкретному филиалу |
| Карта, MapTiler | READY | ключ проверен сборкой APK (HTTP 200) |
| Админ-панель: заявки, партнёры, возвраты, фрод, медиа, ledger, reconciliation, audit | READY | статус показывается настоящий, не подменой через `isActive` |
| Локализация мобильного приложения (ru/hy/en) | READY | новые строки добавлены во все три |
| Локализация веб-панелей | MISSING | только английский; по заданию не блокирует |

## Что означает PARTIAL у legacy `TUTAK-PAY:`

Это единственный оставшийся клиентский идентификатор, который можно
подделать: строка вида `TUTAK-PAY:<partnerId>` конструируется кем угодно.
Денежной дыры в этом нет — покупку всё равно подтверждает сотрудник
партнёра, поэтому подделка даёт лишь заявку в ресторане, где её никто не
подтвердит. Кабинет партнёра печатает такой код только пока у партнёра нет
ни одного филиала; как только филиал появляется, печатаются отзываемые
токены филиалов, а старый код перестаёт открывать покупку.
