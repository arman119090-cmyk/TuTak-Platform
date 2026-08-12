# Готовые запросы для другого ИИ-генератора изображений

Скопировать текст ниже как есть и вставить в Midjourney, DALL-E, Gemini
или похожий инструмент. Если он поддерживает вложение картинки как
референс стиля — приложить `tutak-mark.png` из этой же папки.

Цель — две позы, которых нет в присланном `tutak-logo-source.jpeg` (там
только профиль в три четверти, без монет): анфас для карточки баланса, и
поза с монетами для промо-баннера. См. `README.md` рядом для полного
разбора, что уже вырезано из исходника, а чего там не было и не могло
быть.

## Задание 1 — иллюстрация для карточки баланса (анфас/три четверти)

```
A stylized flat-vector illustration of an African grey parrot — cool grey
layered, scalloped feather texture with soft gradient shading (light grey
highlights over medium grey base, glossy polished look), cream-white
heart-shaped face mask, bright golden-yellow eye with a small dark pupil
and a subtle white glint, dark charcoal curved beak, small patch of vivid
red accent feathers near the tail. Pose: three-quarter to near front-facing
(not side profile), head slightly tilted, friendly alert expression, chest
and upper body visible. Same color palette and illustration style as the
attached reference logo. Fully transparent background (PNG, alpha channel),
no shadow, no ground, centered with even padding on all sides. High
resolution, at least 2000x2000px.
```

## Задание 2 — поза с монетами для промо-баннера

```
The same stylized African grey parrot character — cool grey layered feather
texture, cream-white face mask, golden-yellow eye, dark curved beak, small
red tail accent — same exact color palette and style as the attached
reference. This time perched on top of a small stack of glossy gold coins,
looking down at them with a curious, pleased expression, body at a
three-quarter angle. Flat-vector illustration with soft gradient shading,
no background beyond the coins (transparent PNG, alpha channel), no ground
plane, centered with even padding. High resolution, at least 2000x2000px.
```

## Если генератор нарисует фон вместо прозрачности

Большинство инструментов по умолчанию рисуют белый или цветной фон, даже
если попросить прозрачный. Прислать результат как есть — фон уберётся тем
же способом, каким это уже сделано для `tutak-mark.png` (программно, если
фон окажется примерно однотонным; иначе понадобится модель для вырезания
объекта — тоже можно сделать здесь).
