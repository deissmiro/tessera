# Для агентов
1. Вызови MCP `kit_overview` (сервер tessera-kit).
2. Правишь только `brands/*.brand.json` и `kb/*`.
3. Генерируется, руками не трогать: `tokens/palette/*` и `tokens/brand/*` (palette.py), `tokens/theme.json` и `kb/contrast-pairs.json` (theme_gen.py), `dist/*` (build.py). Исключение — `tokens/palette/common.json`.
4. После любой правки — `run_build`. Ошибка сборки = правка не принята.
