---
id: architecture
summary: Как устроен цвет кита — слои, оси, направление ссылок. Читать агенту первым.
---
# Архитектура цвета

Источник правды — `kit.config.json` и `kb/color-model.json`.

## Три слоя → три коллекции Figma Variables
| Слой | Коллекция | Моды | Что внутри | Ссылается на |
|---|---|---|---|---|
| palette | 0 · Palette | — | Прямые цвета без смысла: `<палитра>/<цвет>/<ступень>` — `tessera/gray/100`, `tessera/indigo/600`, `sunny/yellow/200`. Имя шкалы — по тону (gray, red, burgundy, violet…). Плюс `common/` (белый, чёрный, прозрачности). | — |
| brand | 1 · Brand | бренды | Верхний уровень, собирательный образ бренда. Здесь цвета получают роли: `color/accent-uno/*` → `indigo`, `color/neutral/*` → `gray`; опорные base, dark-base и контент на них. Дальше — типографика, скругления, размеры. | palette |
| theme | 2 · Theme | light, dark | Семантика цвета по модели. | brand |

- Палитра одна на бренд и общая для обеих тем. Тема ничего не хранит, только выбирает ступени.
- Бренд не хранится в палитре: палитра — библиотека, бренд выбирает из неё. Два бренда могут делить одну палитру (`"palette": "<id>"` в brand.json).
- Palette и Brand скрыты из пикеров. Дизайнер выбирает только из Theme.

## Семантика (2 · Theme)
| Группа | Форма | Имена |
|---|---|---|
| ground | два цвета | `ground/page` — страница, `ground/island` — острова на ней. Больше ничего |
| background | плоский набор | `background/<смысл>-<контраст>`: `background/accent-uno-deep` |
| over-background | плоский набор | `over-background/<смысл>-<контраст>`: `over-background/neutral-soft` |
| content | смысл/иерархия | `content/<смысл>/<primary\|secondary\|tertiary\|on-deep>` |
| border | смысл/контраст | `border/<смысл>/<pale\|soft\|deep>` |

Смыслы: neutral, accent-uno/duo, status-positive/negative, brand-uno/duo, static-light/dark, inverse. Inverse в background, over-background и border — один цвет без градаций: `background/inverse`. Какой смысл есть в какой группе — `color-model.json → availability`.

## Правила
1. Ссылки только вниз по таблице слоёв. Проверяет `tools/build.py`.
2. Семантика правится только в `kb/color-model.json`; `tokens/theme.json` генерируется.
3. Палитра и мод бренда генерируются `tools/palette.py` из `brands/<id>.brand.json`.
4. У каждого токена есть описание — оно уезжает в описание переменной Figma.
5. Обязательный контраст — `color-model.json → pairs`; нарушение ломает сборку.
