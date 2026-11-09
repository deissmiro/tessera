---
id: architecture
summary: Как устроен цвет кита — коллекции, тоны бренда, семантика. Читать агенту первым.
---
# Архитектура цвета

Источник правды — `kit.config.json` и `kb/color-model.json`.

## Коллекции Figma Variables
| Слой | Коллекция | Моды | Что внутри | Ссылается на |
|---|---|---|---|---|
| palette | 0 · Palette | — | Прямые цвета по именам: `<палитра>/<цвет>/<ступень>` — `tessera/gray/100`, `tessera/indigo/600`, `sunny/yellow/200`, плюс `common/white`, `common/black`. Без смыслов и без прозрачностей. | — |
| brand | 1 · Brand | бренды | Верхний уровень, образ бренда. `color/neutral/*` — нейтральная шкала (опора soft = #F5F5F5) и её тоны pale / soft / pure / deep; на каждую роль (accent-uno/duo, brand-uno/duo, positive, negative) — четыре тона `pale`, `soft`, `pure`, `deep` + `on-pure`. Дальше — типографика, скругления, размеры. | palette |
| theme | 2 · Theme | light, dark | Семантика цвета. | brand |
| numbers | 3 · Numbers | — | `opacity/0…90` — прозрачность в процентах. | — |
| preset | 5 · Preset | default, overlay | Пресеты — адаптация компонентов к поверхности: default — на ground, overlay — на цветном фоне. Заливки полей, Textarea, Code input, чипсов, Segmented control. | theme |
| platform | 7 · Platform | ios, ios-glass, android | Платформа и версия дизайна iOS (Liquid Glass): нативные компоненты и Layout. | theme |
| skeleton | 6 · Skeleton | off, on | Скелетон загрузки: on — компоненты внутри фрейма показывают заглушки своей формы. | — |
| viewport | 4 · Viewport | s, m, l | Брейкпоинты: телефон (до 767), планшет (768–1279), десктоп (от 1280). Размеры экрана, отступы и поведение компонентов: `window/*`. Мод выбирается на фрейме. | — |

- Палитра одна на бренд и общая для обеих тем. Тема ничего не хранит, только выбирает тоны.
- Тоны одинаковой светлоты у всех брендов: pale ≈ 100, soft ≈ 300, deep ≈ 800; pure — ровно исходный цвет.
- Прозрачности в цветах нет. Нужен полупрозрачный цвет — берёте цвет из Theme и назначаете слою переменную `opacity/N` из Numbers (Figma не умеет хранить переменную прозрачность внутри цветовой переменной).
- Palette и Brand скрыты из пикеров. Дизайнер выбирает из Theme и Numbers.

## Семантика (2 · Theme)
| Группа | Имена |
|---|---|
| ground | `ground/ground-1` — страница, `ground/ground-2` — то, что лежит на странице, `ground/scrim` — затемнение под модальными окнами (чёрный + opacity). Больше ничего |
| background | плоско: `background/<смысл>-<pale\|soft\|deep>` — `background/accent-uno-deep` |
| content | `content/<смысл>/<primary\|secondary\|tertiary\|on-deep>` |
| border | `border/<смысл>/<pale\|soft\|deep>` |

Смыслы: neutral, accent-uno/duo, status-positive/negative, brand-uno/duo, static-light/dark, inverse. Inverse — один цвет: `background/inverse`, `border/inverse`. Static — тоже один цвет на группу, не зависит от темы: `static-light` — белый, `static-dark` — чёрный (`background/static-light`, `content/static-dark`…).

Как тоны бренда ложатся на цветную семантику:
| | светлая | тёмная |
|---|---|---|
| background pale / soft / deep | pale / soft / pure | deep / deep / pure |
| content primary / secondary / on-deep | deep / pure / on-pure | pale / soft / on-pure |
| border pale / soft / deep | pale / soft / pure | deep / pure / pure |

Состояния: ховер и нажатие — соседний тон (pale → soft), затемнение — `ground/scrim` + `opacity/40…60`.

## Компоненты
Контракты — `kb/components/<name>.json` (MCP `get_component`). В Figma их собирает плагин: Tessera Sync → «Обновить и пересобрать компоненты». Сейчас есть: `layout` (стартовый фрейм экрана), `native` (статус-бар, домашний индикатор, клавиатура), `icon` (библиотека Icon/*), `text` (семантический текст со вложенным Skeleton), `skeleton`, `button` (наборы Button/<группа>/<small|medium|large>, варианты scheme × contrast pale|deep × state), `rich-icon` (один компонент RichIcon: size × shape, без цветовых вариантов), `field` и поля той же анатомии (Field/password, number, search, select, phone, date), `textarea`, `switch`, `segmented-control`, `badge`, `tab-bar`, `divider`, `snackbar`, `spinner`, `progress-bar`, `code-input`, `pagination`; скелетон — мод (`skeleton`), `checkbox`, `radio`, `chip`, `navbar` (Navbar/default и Navbar/large, варианты surface), `window`. Основные контролы (чекбокс, радио, чипс) во включённом состоянии — neutral-deep (чёрные).

## Правила
1. Ссылки только вниз по таблице слоёв. Проверяет `tools/build.py`.
2. Семантика правится только в `kb/color-model.json`; `tokens/theme.json` генерируется.
3. Палитра и мод бренда генерируются `tools/palette.py` из `brands/<id>.brand.json`.
4. У каждого токена есть описание — оно уезжает в описание переменной Figma.
5. Обязательный контраст — `color-model.json → pairs`; нарушение ломает сборку.
