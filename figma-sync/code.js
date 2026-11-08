// Tessera Sync — импорт dist/figma/variables.json в файл Figma.
// Идемпотентно: коллекции, моды и переменные находятся по имени и обновляются.

const log = [];
const say = (s) => log.push(s);

function hexToRgba(hex) {
  const h = hex.replace("#", "");
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

async function syncVariables(data) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const existing = await figma.variables.getLocalVariablesAsync();
  const index = {}; // "Collection::name" → Variable
  const ctx = [];

  for (const c of data.collections) {
    let col = collections.find((x) => x.name === c.name);
    if (!col) { col = figma.variables.createVariableCollection(c.name); say(`+ коллекция ${c.name}`); }
    // моды: первый переименовываем, остальные добавляем
    const modeIds = {};
    c.modes.forEach((m, i) => {
      let mode = col.modes.find((x) => x.name === m);
      if (!mode && i === 0 && col.modes.length === 1 && !c.modes.includes(col.modes[0].name)) {
        col.renameMode(col.modes[0].modeId, m); mode = col.modes[0];
      }
      modeIds[m] = mode ? mode.modeId : col.addMode(m);
    });
    for (const v of c.variables) {
      let variable = existing.find((x) => x.variableCollectionId === col.id && x.name === v.name);
      if (!variable) variable = figma.variables.createVariable(v.name, col, v.type);
      variable.description = v.description || "";
      variable.scopes = v.scopes;
      variable.hiddenFromPublishing = !!v.hiddenFromPublishing;
      if (v.codeSyntax && v.codeSyntax.WEB) variable.setVariableCodeSyntax("WEB", v.codeSyntax.WEB);
      index[`${c.name}::${v.name}`] = variable;
      ctx.push({ v, variable, modeIds });
    }
    say(`✓ ${c.name}: ${c.variables.length} переменных, моды ${c.modes.join(", ")}`);
  }

  // второй проход — значения (алиасы ссылаются на уже созданные переменные)
  let missing = 0;
  for (const { v, variable, modeIds } of ctx) {
    for (const [mode, val] of Object.entries(v.valuesByMode)) {
      let value = val;
      if (val && typeof val === "object" && val.$alias) {
        const target = index[val.$alias];
        if (!target) { missing++; continue; }
        value = figma.variables.createVariableAlias(target);
      } else if (v.type === "COLOR") value = hexToRgba(val);
      variable.setValueForMode(modeIds[mode], value);
    }
  }
  if (missing) say(`⚠ не найдено целей алиасов: ${missing}`);
  return index;
}

// Проверочная страница: доска на каждую комбинацию brand × theme с явными модами.
// Все образцы залиты через переменные: пересинк — и страница перекрашивается сама.
async function buildCheckPage(data, index) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const theme = data.collections.find((c) => c.name.includes("Theme"));
  const brandCol = cols.find((c) => c.name.includes("Brand"));
  const themeCol = cols.find((c) => c.name.includes("Theme"));
  const NAME = "Tessera · Color check";
  let page = figma.root.children.find((p) => p.name === NAME);
  if (page) page.children.forEach((n) => n.remove()); else { page = figma.createPage(); page.name = NAME; }
  await figma.setCurrentPageAsync(page);

  const V = (n) => index[`${theme.name}::${n}`];
  const paint = (n) => figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 1, g: 1, b: 1 } }, "color", V(n));
  const fill = (node, n) => { if (V(n)) node.fills = [paint(n)]; };
  const text = (chars, size, bold, colorVar) => {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Semi Bold" : "Regular" };
    t.characters = chars; t.fontSize = size; fill(t, colorVar || "content/neutral/primary");
    return t;
  };
  const stack = (name, dir, gap, pad) => {
    const f = figma.createFrame(); f.name = name; f.layoutMode = dir; f.itemSpacing = gap;
    f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = pad || 0;
    f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; f.fills = [];
    return f;
  };
  const swatch = (label, build) => {
    const cell = stack(label, "VERTICAL", 4);
    const box = figma.createFrame(); box.resize(88, 44); box.cornerRadius = 8; box.fills = [];
    box.layoutMode = "HORIZONTAL"; box.primaryAxisAlignItems = "CENTER"; box.counterAxisAlignItems = "CENTER";
    box.primaryAxisSizingMode = "FIXED"; box.counterAxisSizingMode = "FIXED";
    build(box); cell.appendChild(box);
    const l = text(label, 10, false, "content/neutral/secondary"); cell.appendChild(l);
    return cell;
  };
  const section = (title) => {
    const s = stack(title, "VERTICAL", 10);
    s.appendChild(text(title, 13, true));
    const grid = stack("items", "HORIZONTAL", 10); grid.layoutWrap = "WRAP"; grid.counterAxisSpacing = 12;
    grid.primaryAxisSizingMode = "FIXED"; grid.resize(980, 10);
    s.appendChild(grid);
    return { s, grid };
  };

  const names = theme.variables.map((v) => v.name);
  const by = (g) => names.filter((n) => n.startsWith(g + "/"));
  const short = (n) => n.split("/").slice(1).join("/");

  let x = 0;
  for (const b of brandCol.modes) {
    for (const t of themeCol.modes) {
      const board = stack(`${b.name} · ${t.name}`, "VERTICAL", 28, 40);
      board.setExplicitVariableModeForCollection(brandCol, b.modeId);
      board.setExplicitVariableModeForCollection(themeCol, t.modeId);
      fill(board, "ground/page");
      board.appendChild(text(`${b.name} · ${t.name}`, 22, true));

      // ground — остров на странице
      const g = section("ground");
      let outer = null;
      const levels = by("ground").filter((n) => n !== "ground/page");
      const root = stack("islands", "HORIZONTAL", 0, 0);
      let parent = root;
      for (const n of levels) {
        const isl = stack(short(n), "VERTICAL", 8, 16); isl.cornerRadius = 12; fill(isl, n);
        isl.appendChild(text(short(n), 11, false, "content/neutral/secondary"));
        parent.appendChild(isl); parent = isl;
      }
      g.grid.appendChild(root); board.appendChild(g.s);

      // background и over-background — плоские наборы
      const bg = section("background");
      for (const n of by("background")) bg.grid.appendChild(swatch(short(n), (box) => fill(box, n)));
      board.appendChild(bg.s);
      const ob = section("over-background");
      for (const n of by("over-background")) ob.grid.appendChild(swatch(short(n), (box) => {
        fill(box, n.includes("static-light") ? "background/static-dark-deep" : n.endsWith("/inverse") ? "background/inverse" : "background/neutral-soft");
        const layer = figma.createRectangle(); layer.resize(88, 44); fill(layer, n);
        box.appendChild(layer);
      }));
      board.appendChild(ob.s);

      // content — «Aa» на подходящем фоне
      const ct = section("content");
      for (const n of by("content")) ct.grid.appendChild(swatch(short(n), (box) => {
        const [, m, lvl] = n.split("/");
        const under = lvl === "on-deep" ? `background/${m}-deep`
          : m === "static-light" ? "background/static-dark-deep"
          : m === "inverse" ? "background/inverse" : "ground/island";
        fill(box, under); box.appendChild(text("Aa", 16, true, n));
      }));
      board.appendChild(ct.s);

      // border — обводка на острове
      const bd = section("border");
      for (const n of by("border")) bd.grid.appendChild(swatch(short(n), (box) => {
        fill(box, n.includes("static-light") ? "background/static-dark-deep" : n.endsWith("/inverse") ? "background/inverse" : "ground/island");
        if (V(n)) { box.strokes = [paint(n)]; box.strokeWeight = 2; }
      }));
      board.appendChild(bd.s);

      board.x = x; x += board.width + 80;
      page.appendChild(board);
    }
  }
  figma.viewport.scrollAndZoomIntoView(page.children);
  say(`✓ страница «${NAME}»: ${brandCol.modes.length * themeCol.modes.length} досок brand × theme`);
}

const URL_KEY = "tessera.sourceUrl";

async function run(variables, checkPage) {
  log.length = 0;
  say(`${variables.kit} ${variables.version}`);
  const index = await syncVariables(variables);
  if (checkPage) await buildCheckPage(variables, index);
  return log.join("\n");
}

async function fetchVariables(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now()); // без кэша
  if (!res.ok) throw new Error(`не удалось загрузить ${url}: ${res.status}`);
  return res.json();
}

async function headless(checkPage) {
  const url = await figma.clientStorage.getAsync(URL_KEY);
  if (!url) { figma.notify("Сначала укажите ссылку на variables.json в «Настройки и загрузка файла…»"); figma.closePlugin(); return; }
  try {
    const out = await run(await fetchVariables(url), checkPage);
    const n = out.split("\n").find((l) => l.startsWith("⚠"));
    figma.closePlugin(n ? `Tessera обновлена, но ${n}` : "Tessera обновлена из репозитория ✓");
  } catch (e) { figma.closePlugin("✗ " + (e.message || e)); }
}

if (figma.command === "update") headless(false);
else if (figma.command === "update-check") headless(true);
else {
  figma.showUI(__html__, { width: 360, height: 440 });
  figma.clientStorage.getAsync(URL_KEY).then((url) => figma.ui.postMessage({ url: url || "" }));
  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === "save-url") { await figma.clientStorage.setAsync(URL_KEY, msg.url); figma.ui.postMessage({ log: "Ссылка сохранена." }); return; }
      if (msg.type === "sync-url") {
        await figma.clientStorage.setAsync(URL_KEY, msg.url);
        figma.ui.postMessage({ log: await run(await fetchVariables(msg.url), msg.checkPage) });
        return;
      }
      if (msg.type === "sync") figma.ui.postMessage({ log: await run(msg.variables, msg.checkPage) });
    } catch (e) { figma.ui.postMessage({ log: "✗ " + (e.message || e) }); }
  };
}
