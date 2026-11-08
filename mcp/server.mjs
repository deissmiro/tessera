#!/usr/bin/env node
// Tessera MCP — знание об архитектуре кита для агентов (Claude, Figma Agent и любых MCP-клиентов).
// Без зависимостей: MCP stdio (JSON-RPC 2.0, по строке на сообщение). Запуск: node mcp/server.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY = process.env.PYTHON || "python3";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

function py(args) {
  const r = spawnSync(PY, args, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

let flat = null;
function load() {
  if (!existsSync(join(ROOT, "dist/tokens.flat.json"))) py(["tools/build.py"]);
  flat = existsSync(join(ROOT, "dist/tokens.flat.json")) ? json("dist/tokens.flat.json") : null;
  return flat;
}
const byPath = () => Object.fromEntries((flat?.tokens || []).map((t) => [t.path, t]));
const REF = /^\{([a-z0-9.\-]+)\}$/;

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = Object.fromEntries(m[1].split("\n").map((l) => l.split(/:\s(.+)/).slice(0, 2)));
  return { meta, body: m[2] };
}

function resolveChain(path, ctx) {
  const idx = byPath();
  const axisOf = Object.fromEntries(flat.layers.map((l) => [l.id, l.axis]));
  const chain = [];
  let cur = path;
  for (let i = 0; i < 20; i++) {
    const t = idx[cur];
    if (!t) throw new Error(`нет токена ${cur}`);
    const axis = axisOf[t.layer];
    const mode = axis ? ctx[axis] ?? flat.axes[axis].default : "_";
    const v = t.values[mode];
    chain.push({ path: cur, mode: axis ? `${axis}=${mode}` : "—", value: v });
    const m = typeof v === "string" && v.match(REF);
    if (!m) return { value: v, chain };
    cur = m[1];
  }
  throw new Error("слишком длинная цепочка");
}

const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });

const TOOLS = {
  kit_overview: {
    description: "Начни отсюда. Архитектура кита: слои, оси и моды, правила ссылок, реестр компонентов, список правил базы знаний.",
    inputSchema: { type: "object", properties: {} },
    run() {
      load();
      const counts = {};
      for (const t of flat.tokens) counts[t.layer] = (counts[t.layer] || 0) + 1;
      const rules = readdirSync(join(ROOT, "kb/rules")).map((f) => ({ id: f.replace(".md", ""), ...frontmatter(read(`kb/rules/${f}`)).meta }));
      return text([
        frontmatter(read("kb/architecture.md")).body,
        "## Оси\n" + JSON.stringify(flat.axes, null, 1),
        "## Токенов по слоям\n" + JSON.stringify(counts),
        "## Правила (get_rule)\n" + rules.map((r) => `- ${r.id}: ${r.summary}`).join("\n"),
        "## Модель цвета\nkb/color-model.json — get_rule color-model",
      ].join("\n\n"));
    },
  },
  find_tokens: {
    description: "Поиск токенов по имени и описанию. Используй перед созданием нового токена — возможно, нужная семантика уже есть.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Слова из пути или описания, например 'text secondary' или 'ошибка'" },
      layer: { type: "string", enum: ["palette", "brand", "theme"] },
            limit: { type: "number", default: 40 } } },
    run({ query = "", layer, type, limit = 40 }) {
      load();
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = flat.tokens.filter((t) => (!layer || t.layer === layer) && (!type || t.type === type) &&
        words.every((w) => (t.path + " " + t.description).toLowerCase().includes(w)));
      return text(hits.slice(0, limit).map((t) => `${t.path}  (${t.type})  — ${t.description}  ${JSON.stringify(t.values)}`).join("\n") || "ничего не найдено");
    },
  },
  resolve_token: {
    description: "Разворачивает цепочку ссылок токена до конечного значения в заданном контексте модов.",
    inputSchema: { type: "object", required: ["path"], properties: {
      path: { type: "string", description: "например theme.background.accent-uno-deep" },
      brand: { type: "string" }, theme: { type: "string" } } },
    run({ path, ...ctx }) { load(); return text(resolveChain(path, ctx)); },
  },
  get_rule: {
    description: "Правило базы знаний по id: architecture, color-model, naming, stylization.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    run({ id }) {
      if (id === "architecture") return text(read("kb/architecture.md"));
      if (id === "color-model") return text(read("kb/color-model.json"));
      return text(read(`kb/rules/${id}.md`));
    },
  },
  contrast_report: {
    description: "Отчёт по контрасту пар из kb/contrast-pairs.json для всех brand × theme.",
    inputSchema: { type: "object", properties: { brand: { type: "string" }, theme: { type: "string" }, failingOnly: { type: "boolean", default: false } } },
    run({ brand, theme, failingOnly }) {
      load();
      const rows = flat.contrast.filter((r) => (!brand || r.brand === brand) && (!theme || r.theme === theme) && (!failingOnly || !r.ok));
      return text(rows.map((r) => `${r.ok ? "✓" : "✗"} ${r.brand}/${r.theme} ${r.fg} на ${r.bg}: ${r.ratio}:1 (мин ${r.min})`).join("\n") || "пусто");
    },
  },
  create_brand: {
    description: "Новый бренд: пишет brands/<id>.brand.json, генерирует палитру (коллекция Palette) и мод бренда (коллекция Brand), проверяет контраст в светлой и тёмной теме.",
    inputSchema: { type: "object", required: ["id", "name", "accent"], properties: {
      id: { type: "string", pattern: "^[a-z0-9-]+$" }, name: { type: "string" },
      accent: { description: "hex акцента или { uno, duo }" },
      neutralTint: { type: "number", description: "0 — чистый серый, 0.02 — заметно тонированный в сторону акцента", default: 0.012 },
      status: { type: "object", description: "необязательно: hex для positive / negative / warning / info" },
      brandColors: { type: "object", description: "необязательно: { uno, duo } — фирменные цвета, если отличаются от акцента" },
      palette: { type: "string", description: "необязательно: id чужой палитры, чтобы бренд её переиспользовал" } } },
    run({ id, name, accent, neutralTint = 0.012, status = {}, brandColors, palette }) {
      const spec = { id, name, accent, neutral: { tint: neutralTint }, status,
        ...(brandColors ? { brand: brandColors } : {}), ...(palette ? { palette } : {}) };
      writeFileSync(join(ROOT, `brands/${id}.brand.json`), JSON.stringify(spec, null, 2) + "\n");
      const gen = py(["tools/palette.py", `brands/${id}.brand.json`]);
      const build = py(["tools/build.py"]);
      load();
      return text(gen.out + "\n" + build.out);
    },
  },
  run_build: {
    description: "Генерирует тему из kb/color-model.json, проверяет слои, описания, моды и контраст, собирает dist/ (переменные Figma, CSS). Запускай после любой правки.",
    inputSchema: { type: "object", properties: { checkOnly: { type: "boolean", default: false } } },
    run({ checkOnly }) { const r = py(["tools/build.py", ...(checkOnly ? ["--check"] : [])]); load(); return { ...text(r.out), isError: !r.ok }; },
  },
  figma_payload: {
    description: "Готовые к импорту в Figma переменные (коллекции, моды, алиасы, scopes, описания). Для Figma-агента или плагина figma-sync.",
    inputSchema: { type: "object", properties: { collection: { type: "string", description: "Palette | Brand | Theme" } } },
    run({ collection }) {
      load();
      const data = json("dist/figma/variables.json");
      if (collection) data.collections = data.collections.filter((c) => c.name.includes(collection));
      return text(data);
    },
  },
};

const handlers = {
  initialize: (p) => ({ protocolVersion: p?.protocolVersion || "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "tessera-kit", version: "0.2.0" },
    instructions: "Это кит Tessera. Вызови kit_overview перед любой работой. Семантика цвета правится только в kb/color-model.json, бренды — через create_brand. Руками не править tokens/palette, tokens/brand, tokens/theme.json. После правок — run_build." }),
  "tools/list": () => ({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) }),
  "tools/call": (p) => {
    const t = TOOLS[p.name];
    if (!t) throw new Error(`нет инструмента ${p.name}`);
    try { return t.run(p.arguments || {}); } catch (e) { return { ...text(String(e.message || e)), isError: true }; }
  },
  ping: () => ({}),
};

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === undefined) continue; // уведомления (notifications/initialized и т.п.)
    const h = handlers[msg.method];
    const reply = { jsonrpc: "2.0", id: msg.id };
    if (!h) reply.error = { code: -32601, message: `method not found: ${msg.method}` };
    else { try { reply.result = h(msg.params); } catch (e) { reply.error = { code: -32000, message: String(e.message || e) }; } }
    process.stdout.write(JSON.stringify(reply) + "\n");
  }
});
