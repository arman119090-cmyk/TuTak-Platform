# TuTak Android — почему SurfaceMountingManager отсоединяет сфокусированный ReactEditText

**Дата:** 9 сентября 2026
**Коммит анализа:** `dd459df` (APK 40, run `QUISEI`, `END records=144`)
**Ветка:** `claude/android-keyboard-diagnostics-20260908`
**Статус:** механизм установлен по коду. **Причина не доказана на устройстве.**

---

## 0. Короткий ответ

`TextField` добавляет `shadowColor` на внутренний `<View>` поля **только когда поле
в фокусе**. В Fabric `shadowColor` входит в предикат `formsStackingContext`. Из-за
этого при получении фокуса этот `<View>` переходит из «плоского» состояния в
«стековый контекст», и differ реагирует на это не обновлением, а
**переносом всех его детей**: `REMOVE` из прежнего родителя и `INSERT` в него.
Одним из этих детей и является сфокусированный `ReactEditText`.

То есть `removeViewAt` вызывает не clipping, не ScrollView и не пересоздание
компонента, а **flatten → unflatten** внутри самого `TextField`, вызванный ровно
одним свойством стиля, которое меняется ровно на фокусе.

Дальше — цепочка Android: удаление сфокусированной view → `clearChildFocus` →
арбитраж фокуса → клавиатура закрывается.

---

## 1. Что показывает сам стек (и что он уже исключает)

```
View.dispatchDetachedFromWindow
ViewGroup.removeViewInternal
ViewGroup.removeViewAt          ← обычный путь, не clipping
ReactClippingViewManager.removeViewAt
SurfaceMountingManager.removeViewAt
IntBufferBatchMountItem.execute
```

`ReactClippingViewManager.removeViewAt` (RN 0.86.2,
`ReactAndroid/.../views/view/ReactClippingViewManager.kt:58`):

```kotlin
override fun removeViewAt(parent: T, index: Int) {
  val removeClippedSubviews = parent.removeClippedSubviews
  if (removeClippedSubviews) {
    parent.removeViewWithSubviewClippingEnabled(child)   // ← НЕ эта ветка
  } else {
    parent.removeViewAt(index)                            // ← эта
  }
}
```

В стеке стоит `ViewGroup.removeViewAt`, то есть выполнилась ветка `else`.

**Следствие 1 (доказано стеком):** у родителя, который удалил `ReactEditText`,
`removeClippedSubviews` был **выключен**. Пункт 3 задания — `removeClippedSubviews`
как причина — **исключён этим стеком**, а не предположением.

**Следствие 2:** `ReactClippingViewManager` — базовый класс `ReactViewManager`,
менеджера обычного `<View>`. Значит родитель, из которого удалили поле, — это
`<View>`, а не `ScrollView` и не `TextInput`.

---

## 2. Дерево `TextField` и что на самом деле монтируется

`apps/mobile/src/presentation/components/TextField.tsx`:

```
W  <View ref onTouchStart onLayout style={{marginBottom}}>      строка 115
   ├─ <Text>{label}</Text>
   ├─ F  <View style={[styles.field, {...}, ring?, error?]}>    строка 149
   │     ├─ {prefix ? <Text>+374</Text> : null}
   │     └─ <TextInput ref … />                                 ← #2988
   └─ {error ? <Text/> : hint ? <Text/> : null}
```

В Fabric «есть ли у узла нативная view» и «монтируются ли его дети внутрь него» —
**два разных решения**, и они управляются разными признаками
(`ReactCommon/react/renderer/components/view/ViewShadowNode.cpp:50-88`):

```cpp
bool formsStackingContext = !viewProps.collapsable || … ||
    isColorMeaningful(viewProps.shadowColor) || …             // :59
    || HostPlatformViewTraitsInitializer::formsStackingContext(viewProps);

bool formsView = formsStackingContext ||
    isColorMeaningful(viewProps.backgroundColor) || hasBorder() || …   // :70
```

на Android (`HostPlatformViewTraitsInitializer.h:17`):

```cpp
inline bool formsStackingContext(const ViewProps &viewProps)
{ return viewProps.elevation != 0; }
```

Теперь считаем для `F` **без фокуса и без ошибки**:

| свойство | значение | вклад |
| --- | --- | --- |
| `backgroundColor` | `rgba(255,255,255,0.05)` | `formsView` = true |
| `borderWidth: 1` | есть | `formsView` = true |
| `shadowColor` | **отсутствует** | `formsStackingContext` = false |
| `elevation` | **отсутствует** | `formsStackingContext` = false |
| обработчики касаний | нет (они на `W`) | `events.bits` пусто |
| `overflow`, `opacity`, `transform`, `zIndex` | по умолчанию | нет вклада |

→ **`F.formsView = true`, `F.formsStackingContext = false`.**

А это ровно то, что решает судьбу детей
(`ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp:119`):

```cpp
bool areChildrenFlattened =
    (!childShadowNode.getTraits().check(ShadowNodeTraits::Trait::FormsStackingContext)
     && !childrenFormStackingContexts) || ForceFlattenView;
```

`areChildrenFlattened` записывается в `ShadowViewNodePair::flattened`. Значит
**в покое дети `F` подняты на уровень выше — в `W`**:

```
W  (ReactViewGroup)
├─ ReactTextView            label
├─ ReactViewGroup           F — рисует фон и рамку, но пустая
├─ ReactTextView            prefix «+374»   ← поднят из F
└─ ReactEditText  #2988     поле            ← поднят из F
```

`W` при этом сам стековый контекст: у него `onTouchStart`, то есть
`viewProps.events.bits.any()` истинно. Поэтому дети `F` поднимаются ровно до `W` и
не выше — и именно `W` (обычный `<View>`, то есть `ReactClippingViewManager`)
оказывается тем родителем, который в стеке вызывает `removeViewAt`.

---

## 3. Что происходит на фокусе

`TextField.tsx:158-161`:

```tsx
focused && !error
  ? { shadowColor: premium.brand.primary, ...styles.ring }
  : null,
```

`premium.brand.primary = '#5B8CFF'`, непрозрачный. На Android
`isColorMeaningful` — это `alpha > 0`
(`graphics/platform/android/…/HostPlatformColor.h:63`).

Поэтому по `onFocus` → `setFocused(true)` → перерисовка → у `F` **появляется
`shadowColor`** → `formsStackingContext` становится `true` → `flattened`
становится `false`.

И differ обрабатывает именно это изменение
(`ReactCommon/react/renderer/mounting/Differentiator.cpp:201`):

```cpp
if (oldPair.flattened != newPair.flattened) {
  …
  // Unflattening
  calculateShadowViewMutationsFlattener(scope, ReparentMode::Unflatten, …);
}
```

Результат транзакции:

```
REMOVE  ReactTextView(prefix)  из W
REMOVE  ReactEditText #2988    из W      ← ndetach
INSERT  ReactTextView(prefix)  в  F
INSERT  ReactEditText #2988    в  F
```

Тег `#2988` при этом **не меняется** — сама view не пересоздаётся, её только
переносят. Это ровно то, что в журнале: `ndetach ReactEditText#2988`, тот же тег
до и после, никаких `mount`/`unmount` на уровне React.

На `blur` происходит обратное: `shadowColor` исчезает, `F` снова становится
плоским, дети переносятся обратно в `W` — **второй detach**.

---

## 4. Почему это объясняет всё, что уже наблюдалось

| наблюдение | объяснение этим механизмом |
| --- | --- |
| Нет `REQ blur` из JS | Фокус снимает Android при detach, JS команду не посылал |
| Теги стабильны, нет `mount`/`unmount` | Перенос view, а не пересоздание |
| Окно не меняет размер | Механизм к окну не относится |
| Триггер — само событие фокуса | `setFocused` — единственное, что меняет стиль |
| Единственная удачная попытка: `REQ focus` **без** события фокуса | Поле уже было в фокусе → `setFocused` не вызван → перерисовки нет → нет перехода flatten/unflatten → клавиатура выжила |
| `elevation` убрали — ничего не изменилось (`OZPR8P`, `1c9c823`) | Убрали только `elevation` из `styles.ring`; **`shadowColor` остался** и один продолжал переключать `formsStackingContext`. Нулевой результат того опыта этим механизмом не просто совместим — он им **предсказан** |
| `SCF=off` 8/8 без изменений | `scrollsChildToFocus` к транзакции монтирования отношения не имеет |
| `keyboardShouldPersistTaps="always"` убрал `REQ blur`, но не сбой | Это был другой, независимый дефект — он и вылечен |
| Один-единственный `of=1` на OtpLogin тоже ломается | Механизм внутри одного `TextField`, второе поле не нужно |
| На Login фокус ходит `#36 ↔ #46` | Следствие: см. раздел 6 |
| Xiaomi и Samsung одинаково | Механизм в RN, не в прошивке |

---

## 5. Пункт 4 задания: что ещё могло бы заставить Fabric убрать ребёнка — и что из этого проверено

| кандидат | проверка по коду `dd459df` | вывод |
| --- | --- | --- |
| `removeClippedSubviews` | нигде в `src/` и `packages/design/src/` не задан; у `ScrollView` контент-view получает `this.props.removeClippedSubviews` = `undefined`; **и стек показывает ветку `else`** | исключён |
| Условный рендеринг внутри `TextField` | `{prefix ? … : null}` и `{error ? … : hint ? … : null}` — ни `prefix`, ни `error`, ни `hint` не зависят от фокуса | не срабатывает на фокусе |
| Условный рендеринг на экране | `OtpLogin`: `{!codeSent ? … : …}`; `codeSent` меняется только после запроса кода | не срабатывает на фокусе |
| Смена `key` | ни одного `key` на этих ветках нет | нет |
| Смена идентичности компонента / подмена обёртки | `TextField` — одна и та же функция, `<View>`/`<TextInput>` — одни и те же типы | нет |
| Перерисовка предка | `focused` — локальный `useState` внутри `TextField`; ни один предок на фокусе не перерисовывается | нет |
| `compact` из `useCompactLayout` | зависит от размера окна; окно не меняется (доказано ранее) | нет |
| `keyboardInset` в `KeyboardAwareScroll` | меняет только `paddingBottom` контейнера; и по времени приходит **после** detach | нет |
| **Переход flatten → unflatten у `F`** | `shadowColor` появляется ровно на фокусе, `formsStackingContext` переключается | **единственный найденный кандидат** |

Дополнительно: у контент-view `ScrollView` стоит `collapsableChildren={!preserveChildren}`,
а `preserveChildren` здесь ложно (`maintainVisibleContentPosition` и
`snapToAlignment` не заданы). То есть уплощение внутри наших форм включено —
условие, без которого описанный механизм был бы невозможен.

---

## 6. Пункты 5 и 6: теги и `ReactViewGroup#2992`

**Как читать `#N`.** `FocusTraceModule.describe()` возвращает
`"${view.javaClass.simpleName}#${view.id}"`, а `ViewManager.createView`
документирован как «`reactTag` that should be set as ID of the view instance».
Значит `#N` — это **react tag**, а не Android resource id. Подтверждается
независимо: JS пишет `focus phone t=2988`, native — `ReactEditText#2988`.

- **`#2988` = `<TextInput>` поля `phone`.** Подтверждено с двух сторон.
- **`#2990` и `#2992` = два `<View>` внутри `TextField`** — `F` (коробка поля) и
  `W` (обёртка). Это **вывод, а не измерение**: Fabric выдаёт теги в порядке
  завершения узлов (дети раньше родителей), шаг 2, и сразу над `TextInput` в этом
  порядке стоят именно `F`, затем `W`. Какой из двух — `#2992`, из журнала
  **не установлено**.
- **`#36 ↔ #46` на Login** — два `<TextInput>` (`phone` и `password`). Расстояние
  между тегами равно числу host-узлов одного `TextField`; точная арифметика
  зависит от того, сколько тегов занимает `<Text>` (параграф + текстовый узел),
  поэтому это **согласуется**, но не является доказательством.

**Почему на Login фокус ходит между полями.** `ViewGroup.removeViewInternal` при
удалении сфокусированного ребёнка снимает с него фокус и вызывает
`rootViewRequestFocus()`. Тот спускается по дереву и ищет следующий focusable —
и это ровно тот `ScrollView.onRequestFocusInDescendants`, который виден в ваших
стеках. На двух полях он попадает во второе поле → второе поле получает фокус →
`setFocused(true)` → его `F` разуплощается → detach → обратно. **Пинг-понг —
следствие, а не причина**, что совпадает с прежней переформулировкой дефекта.

**`nfocus ReactViewGroup#2992 → none`.** Здесь честно: **не установлено.**
`ReactViewGroup` по умолчанию не focusable, поэтому то, что он вообще держал
фокус, само требует объяснения. Два кандидата:

1. арбитраж после detach: `clearChildFocus` → `rootViewRequestFocus` временно
   отдал фокус группе-предку, затем фокус ушёл в «none»;
2. это промежуточное состояние, которое `OnGlobalFocusChangeListener` сообщает
   в процессе `clearChildFocus`, а не устойчивый фокус.

Различить их можно тремя строками инструментации: писать в журнал
`findNodeHandle(wrapper.current)` и тег коробки поля на `onLayout`. Тогда `#2990`
и `#2992` перестают быть выводом и становятся измерением. Это **не** меняет
поведения и может быть добавлено вместе с экспериментом ниже.

---

## 7. Чего это НЕ доказывает

- Что описанный механизм — **причина** дефекта. По коду он объясняет каждое
  наблюдение и предсказывает нулевой результат опыта с `elevation`, но
  мутационный список Fabric на устройстве **не наблюдался**.
- Что других источников `removeViewAt` нет. Найден один кандидат; отсутствие
  второго не доказано.
- Ничего про `RR`. Данных по `RR=off` по-прежнему нет, и этот анализ их не
  заменяет.
- Что `#2992` — обёртка `TextField`.

**Отдельная оговорка о порядке строк в журнале.** Колонка `NNNNNms` у строк
`nfocus`/`ndetach` — это момент, когда JS **вычитал** запись из нативного буфера
(интервал 250 мс), а не момент события. Поэтому в ваших выдержках `ndetach`
стоит то до, то после `blur` — по этой колонке native и JS строки **нельзя**
упорядочивать между собой. Упорядочивать можно только по `@uptime` внутри native
строк. См. также раздел 8, пункт 2.

---

## 8. ОДИН минимальный контролируемый эксперимент

**Что менять:** добавить `collapsable={false}` на `<View>` коробки поля
(`TextField.tsx:149`) — под кнопкой-переключателем в диагностической панели
(третья ветвь, `CF`), по умолчанию **выключенной**, то есть в точности текущее
поведение. Обе ветви — в одной сборке, одном запуске и одном телефоне.

**Почему именно это, а не `RR`:**

- `collapsable={false}` даёт `!viewProps.collapsable` → `formsStackingContext`
  **всегда истинно** (`ViewShadowNode.cpp:50`). Значит `flattened` не переключается
  ни в одну сторону. **Меняется ровно один параметр.** Внешний вид, кольцо,
  цвета, перерисовка, разметка — всё остаётся байт в байт прежним.
- `RR=off` убирает перерисовку целиком, а вместе с ней сразу три изменения
  свойств. Если после него станет хорошо, это не скажет, **почему**.

**Критерий, объективный и не зависящий от ощущений:**

> между `focus <поле>` и следующим `blur <поле>` в журнале **не должно быть**
> строки `ndetach ReactEditText#<тот же тег>`.

- Ветвь `CF=off` (как сейчас): `ndetach` присутствует → механизм воспроизведён.
- Ветвь `CF=on`: `ndetach` исчезает → **переход flatten/unflatten подтверждён как
  причина**.
- `ndetach` остаётся в обеих ветвях → гипотеза мертва, транзакцию порождает
  что-то другое, и следующий шаг — снимать сам список мутаций.

**Что НЕ делается:** ничего не «чинится». `collapsable={false}` в этом коммите —
инструмент, а не исправление; ветвь по умолчанию выключена, поведение сборки без
нажатия кнопки не меняется.

Сборку APK 41 с этой ветвью можно выпустить примерно за 20 минут — по вашему
слову.

---

## 9. Пункт 8: пять замечаний Astra к native-трассировке (`00b03f9`)

Сверяю с формулировками из вашего же задания, по которому она писалась. Если
список Astra отличается — поправьте, проверю по нему.

| # | Замечание | Состояние | Где |
| --- | --- | --- | --- |
| 1 | Не обещать, что один `OnGlobalFocusChangeListener` покрывает все точки | **Выполнено** | `FocusTraceModule.kt`, шапка: стек назван «стеком уведомления, а не причины»; отдельным абзацем перечислено непокрытое — записи `inputType`, `keyListener`, `focusable` у `ReactEditText`. То же повторено в `nativeFocusTrace.ts` |
| 2 | Сохранять native timestamps | **Выполнено частично** | `uptime = SystemClock.uptimeMillis()` и `wall = System.currentTimeMillis()` пишутся в запись, но `describe()` в `nativeFocusTrace.ts` выводит **только** `@uptime`. `wall` в журнал не попадает — а именно он нужен, чтобы сопоставлять native и JS строки. Плюс колонка `NNNNNms` у native строки — это время вычитки, и в самой строке это не помечено. Обе правки маленькие |
| 3 | Не терять события до готовности JS-получателя | **Выполнено** | Буфер заполняется с `start()`, JS забирает опросом (`drain`), 250 мс; при размонтировании делается финальный `drain()`. Ограничение честное: кольцо на 400 записей может вытеснить самые старые, и до вызова `start()` не пишется ничего — этого не может ни один вариант |
| 4 | Не добавлять предполагаемое исправление поведения | **Выполнено** | Модуль только наблюдает: три слушателя, буфер, `drain`. Ни одного вызова, меняющего фокус, разметку или свойства |
| 5 | Изолировать от production; не писать секреты и содержимое полей | **Выполнено** | `useNativeFocusTrace` не делает ничего вне `isDiagnosticBuild()`. `describe()` — только имя класса и `view.id`; стек — класс, метод, строка. Текст, номера, коды, токены попасть не могут. Точная формулировка: код модуля автолинкуется в любую сборку, но **не запускается** нигде, кроме диагностической |

Итого: три из пяти закрыты полностью, пункт 2 — с реальным пробелом (`wall` не
доходит до журнала), пункт 3 — с честно названными границами.

---

## 10. Что не трогалось

Production, deploy, merge, Viva, backend и ветка Codex — не тронуты. Поведение
приложения в этом анализе не менялось: ни одной правки кода в рамках этой задачи
не сделано.
