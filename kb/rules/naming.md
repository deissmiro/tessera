---
id: naming
summary: Имена цветовых токенов и переменных.
---
- В JSON сегменты через точку, в Figma через `/`: `theme.background.accent-uno-deep` → `background/accent-uno-deep` в коллекции `2 · Theme`.
- Палитра: шкалы называются по цвету (`gray`, `indigo`, `burgundy`), без смыслов. Смысл даёт Brand, семантику — Theme.
- ground: только `page` и `island`. Других цветов в ground не бывает.
- inverse в background, over-background, border — один токен: `background/inverse`.
- background и over-background: плоско, `<смысл>-<контраст>`, без подпапок.
- content и border: `<смысл>/<модификатор>`.
- Состояния (hover, pressed, selected) — не отдельные цвета, а слой over-background поверх заливки.
- Новые группы, смыслы и уровни — только через kb/color-model.json.
