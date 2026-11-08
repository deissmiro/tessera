# Tessera — цвет

Сейчас в ките только цвет. Документации нет: знание — в описаниях переменных и в `kb/`, агенты читают его через MCP.

## Слои
`0 · Palette` (прямые цвета по именам: gray, indigo, yellow…, без модов) → `1 · Brand` (моды = бренды, верхний уровень) → `2 · Theme` (light / dark, семантика).
Подробно — `kb/architecture.md`, модель цвета — `kb/color-model.json`.

## Figma: обновление без скачивания файлов
Один раз:
1. Залейте репозиторий на GitHub (ветка main). Можно приватный — тогда см. примечание ниже.
2. Figma Desktop → Plugins → Development → Import plugin from manifest… → `figma-sync/manifest.json`.
3. Plugins → Tessera Sync → «Настройки и загрузка файла…» → вставьте ссылку
   `https://raw.githubusercontent.com/<user>/<repo>/main/dist/figma/variables.json` → «Обновить из репозитория».

Дальше:
- меняете `brands/*.brand.json` или `kb/color-model.json` и пушите (или это делает агент);
- GitHub Action сам пересобирает палитры, тему и `dist/`;
- в Figma: Plugins → Tessera Sync → «Обновить из репозитория» (или ⌥⌘P — повтор последнего плагина). Переменные обновятся по имени, связи в макетах сохранятся.

Приватный репозиторий: raw-ссылки требуют токен, поэтому для приватного репозитория публикуйте `variables.json` в публичный gist (gist.githubusercontent.com тоже разрешён) или сделайте отдельный публичный репозиторий только с `dist/`.
Полностью без кликов в Figma — только REST Variables API (тариф Enterprise): Action может сам писать переменные в файл.

## Без GitHub
`python3 tools/build.py` → в плагине «Настройки и загрузка файла…» → «Загрузить файл» → `dist/figma/variables.json`.

## Агенты
`.mcp.json` в корне подключает сервер tessera-kit (`node mcp/server.mjs`) в Claude Code. Для Claude Desktop добавьте его в конфиг MCP-серверов.
