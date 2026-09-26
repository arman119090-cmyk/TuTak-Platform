# Клавиатура и фокус на Android: отчёт по раунду 3

**Сборка:** `apk-diagnostic-34`
**Ссылка:** https://github.com/arman119090-cmyk/TuTak-Platform/releases/tag/apk-diagnostic-34
**SHA:** `ca9c2316dc7295784036a099f9d47bc179a2dba7` (в панели — `ca9c231`)
**Ветка:** `claude/android-keyboard-diagnostics-20260908`
**API:** `https://tutak-staging-api.onrender.com/v1` (staging)
**Merge и deploy не выполнялись. Viva и PR №30 не затронуты.**

---

## 1. Итог по дефекту на сегодня

Дефект оказался **двумя разными неисправностями**, а не одной.

| Часть | Статус |
|---|---|
| **A. Приложение само закрывало себе клавиатуру** | **Исправлено и подтверждено на устройстве** |
| **B. Фокус мигрирует между полями и садится на первое** | Исправление-кандидат в сборке 34, **не подтверждено** |

## 2. Часть A — закрыта

### Что было

Нативный `ScrollView` React Native снимает фокус с поля, когда касание
приходит мимо него:

```js
if (currentlyFocusedTextInput != null &&
    this.props.keyboardShouldPersistTaps !== true &&
    this.props.keyboardShouldPersistTaps !== 'always' &&
    this._keyboardIsDismissible() &&
    e.target !== currentlyFocusedTextInput && …) {
  TextInputState.blurTextInput(currentlyFocusedTextInput);
}
```

Приложение передавало `keyboardShouldPersistTaps="handled"` — значение,
проходящее **все** эти условия. Вызов лежит в `ScrollView.js` React Native, и
никаким поиском по нашему репозиторию его не найти.

### Доказательство

Журнал сборки 32 (`run OZPR8P`) — дважды:

```
REQ blur phone src=anonymous     ← команда из JS, не отчёт
blur  phone t=36
kbHide on=none of=2
```

`REQ` пишется только для команд (`blurTextInput`), а не для учёта из
`onBlur`. И это не `Keyboard.dismiss()` — для него отдельная строка
`REQ dismiss`, её нет.

### Исправление

`keyboardShouldPersistTaps: "handled" → "always"` в `KeyboardAwareScroll`.
Путь исключён явно; первое нажатие по кнопке под клавиатурой продолжает
работать, ради чего `handled` и ставилось.

**Цена:** касание по фону больше не закрывает клавиатуру.

### Подтверждение

Журнал сборки 33 (`run DFPO48`, commit `f7e0f65`): **ни одной строки
`REQ blur`, ни одной `kbHide`** за весь прогон. Проверено на живом устройстве.

## 3. Часть B — кандидат, не подтверждён

### Что наблюдается

```
20202ms  REQ focus password        ← палец
20203ms  blur phone / focus password
20232ms  blur password / focus phone     (+29 мс)
20264ms  blur phone / focus password     (+32 мс)
20264ms  blur password / focus phone     (0 мс)
20281ms  kbShow h=332 on=phone
```

Четыре перехода, окончание всегда на первом поле, независимо от того, куда
нажали. Практический смысл: **во второе поле попасть невозможно.**

### Что найдено

`ReactScrollView.java` (RN 0.86.2):

```java
@Override
public void requestChildFocus(View child, View focused) {
  if (focused != null && mScrollsChildToFocus) {
    scrollToChild(focused);
  }
  requestChildFocusWithoutScroll(child, focused);
}
```

`scrollsChildToFocus` по умолчанию **true** — значит на каждое получение
фокуса нативный список прокручивается к полю. В комментарии React Native над
этим методом прямо сказано, что путь намеренно обходит проверку
`mIsLayoutDirty`, которой стоковый Android защищается от прокрутки посреди
прохода вёрстки.

Почему это лучший кандидат из всех проверенных:

1. срабатывает ровно на смене фокуса;
2. лежит в общем `ScrollView` — оба экрана, оба вендора (Xiaomi и Samsung);
3. ритм совпадает: 25–35 мс — это прокрутка плюс вёрстка, а не мгновенный
   native-поиск;
4. объясняет окончание на первом поле: `ScrollView.onRequestFocusInDescendants`
   с пустым rect возвращает первого фокусируемого потомка сверху;
5. **это противоречие внутри нашего кода.** `KeyboardAwareScroll` уже принял
   решение не прокручивать к сфокусированному полю — `ensureVisible` сделан
   пустышкой (`NO_SCROLLING`), и в комментарии записано, почему авто-прокрутку
   убрали. Нативную половину этим выключить было нельзя. **Приложение имело
   авто-прокрутку, которую считало удалённой.**

### Исправление

`scrollsChildToFocus={false}`. Оправдано само по себе, независимо от исхода:
список должен прокручиваться, когда его прокручивает человек, а не когда поле
получило фокус. Проп андроидный, на iOS игнорируется.

## 4. Что проверено и отвергнуто по дороге

| Гипотеза | Как отвергнута |
|---|---|
| JS вызывает `.focus()` / `.blur()` | Отсутствием `REQ` перед аномальными переходами. Перехвачены только команды, не учёт |
| Пересоздание Activity, перезапуск RN surface, remount | Постоянством native-тегов и отсутствием `mount`/`unmount` в журнале |
| Сжатие окна под клавиатуру (`adjustResize`) | `win` и `scr` не менялись ни разу |
| Samsung Pass / вендорский автозаполнитель | Идентичный сбой на Xiaomi |
| Складной экран, режим совместимости | Xiaomi не складной |
| `secureTextEntry` / поле пароля | На регистрации второе поле обычное текстовое |
| `elevation` в подсветке поля | Сборка 32 была без него — рисунок не изменился. Правка откачена |
| `removeClippedSubviews` | Не включён |
| Штатный Android Autofill | `autoComplete="off"` компилируется в `IMPORTANT_FOR_AUTOFILL_NO` для обоих полей |

## 5. Что проверить на телефонах (оба: Samsung и Xiaomi)

После установки 34, на экране входа:

**Проверка A — должна была починиться раньше.** Нажать на поле, дождаться
клавиатуры, затем нажать на пустое место экрана. Клавиатура **не должна**
закрываться.

**Проверка B — это чинится сейчас.** Нажать на второе поле («Password» на
входе, «Referral code» на регистрации). **Фокус остаётся там и можно
печатать — да или нет?**

**Проверка C — не сломалось ли соседнее.** Прокрутить форму пальцем — она
должна прокручиваться как раньше. Нажать кнопку под клавиатурой — должна
срабатывать с первого раза.

Затем: **CLEAR** → повторить → **EXPORT**.

## 6. Проверки

| Проверка | Результат |
|---|---|
| `apps/mobile` tests | **363 / 363**, 44 сюиты |
| `apps/mobile` typecheck | pass |
| `apps/mobile` lint | pass |
| `scripts/build-demo-app.sh` + drift | pass, чисто |
| APK 34 | распакован и проверен: `diagnostics: true`, commit `ca9c231` |

Regression-тесты: `KeyboardAwareScroll.test.tsx` закрепляет
`keyboardShouldPersistTaps === 'always'` (и отдельно — что оно **не**
`handled`) и `scrollsChildToFocus === false`.

## 7. Чего ещё нет

* Подтверждения части B на устройстве — только оно закроет дефект.
* iOS — **NOT VERIFIED**.
* Правок вне `apps/mobile`, `demo/` и `docs/` не было.

**Коммиты раунда:** `f7e0f65` (часть A), `ca9c231` (часть B).
