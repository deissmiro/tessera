---
id: naming
summary: Имена цветовых токенов и переменных.
---
- В JSON сегменты через точку, в Figma через `/`: `theme.background.accent-uno-deep` → `background/accent-uno-deep` в коллекции `2 · Theme`.
- Палитра: шкалы называются по цвету (`gray`, `indigo`, `burgundy`), без смыслов. Смысл даёт Brand, семантику — Theme.
- Бренд: на роль четыре тона `pale`, `soft`, `pure`, `deep` + `on-pure`.
- ground: только `ground-1` и `ground-2`. Других цветов в ground не бывает.
- inverse в background и border — один токен: `background/inverse`.
- background: плоско, `<смысл>-<контраст>`, без подпапок.
- content и border: `<смысл>/<модификатор>`.
- Состояния (hover, pressed) — соседний тон. Прозрачность — переменная `opacity/N` из Numbers на слое, не цвет.
- Новые группы, смыслы и уровни — только через kb/color-model.json.
