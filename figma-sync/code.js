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
      try { if (v.type !== "BOOLEAN") variable.scopes = v.scopes; } catch (e) { say(`⚠ scopes ${v.name}: ${e.message}`); }
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

  // чистка: в коллекциях кита удаляем переменные, которых больше нет в репозитории
  const keep = new Set(Object.values(index).map((v) => v.id));
  const managed = new Set(ctx.map((c) => c.variable.variableCollectionId));
  let removed = 0;
  for (const v of await figma.variables.getLocalVariablesAsync()) {
    if (managed.has(v.variableCollectionId) && !keep.has(v.id)) { v.remove(); removed++; }
  }
  if (removed) say(`− удалено устаревших переменных: ${removed}`);
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
  if (page) { await page.loadAsync(); page.children.forEach((n) => n.remove()); } else { page = figma.createPage(); page.name = NAME; }
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
      fill(board, "ground/ground-1");
      board.appendChild(text(`${b.name} · ${t.name}`, 22, true));

      // ground — уровни, вложенные друг в друга
      const g = section("ground");
      const levels = by("ground").filter((n) => n !== "ground/ground-1");
      const root = stack("ground", "HORIZONTAL", 0, 0);
      let parent = root;
      for (const n of levels) {
        const isl = stack(short(n), "VERTICAL", 8, 16); isl.cornerRadius = 12; fill(isl, n);
        isl.appendChild(text(short(n), 11, false, "content/neutral/secondary"));
        parent.appendChild(isl); parent = isl;
      }
      g.grid.appendChild(root); board.appendChild(g.s);

      // background — плоский набор
      const bg = section("background");
      for (const n of by("background")) bg.grid.appendChild(swatch(short(n), (box) => fill(box, n)));
      board.appendChild(bg.s);

      // content — «Aa» на подходящем фоне
      const ct = section("content");
      for (const n of by("content")) ct.grid.appendChild(swatch(short(n), (box) => {
        const [, m, lvl] = n.split("/");
        if (m === "static-dark") { fill(box, "background/static-light"); box.appendChild(text("Aa", 16, true, n)); return; }
        const under = lvl === "on-deep" ? `background/${m}-deep`
          : m === "static-light" ? "background/static-dark"
          : m === "inverse" ? "background/inverse" : "ground/ground-2";
        fill(box, under); box.appendChild(text("Aa", 16, true, n));
      }));
      board.appendChild(ct.s);

      // border — обводка на острове
      const bd = section("border");
      for (const n of by("border")) bd.grid.appendChild(swatch(short(n), (box) => {
        fill(box, n.includes("static-light") ? "background/static-dark" : n.endsWith("/inverse") ? "background/inverse" : "ground/ground-2");
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

// @components
// ---- Компоненты кита. Собираются по kb/components/*.json; все значения — привязки к переменным.
async function buildComponents(index) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var col = (part) => cols.find((c) => c.name.includes(part));
  var V = (coll, name) => {
    const v = index[`${col(coll).name}::${name}`];
    if (!v) say(`⚠ нет переменной ${coll}::${name}`);
    return v;
  };
  var T = (n) => V("Theme", n), VP = (n) => V("Viewport", n), N = (n) => V("Numbers", n);
  var bind = (node, field, v) => { if (v) node.setBoundVariable(field, v); };
  var paint = (v) => figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }, "color", v);
  var fill = (node, themeName) => { const v = T(themeName); if (v) node.fills = [paint(v)]; };
  var PR = (n) => V("Preset", n);
  var SKV = () => V("Skeleton", "visible");
  // Скелетон: серый слой поверх всего компонента; виден, когда на фрейме мод Skeleton = on.
  var skeletonOverlay = (node) => {
    const r = figma.createRectangle(); r.name = "skeleton"; fill(r, "background/neutral-soft");
    node.appendChild(r); r.layoutPositioning = "ABSOLUTE"; r.x = 0; r.y = 0; r.resize(Math.max(node.width, 1), Math.max(node.height, 1));
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" }; node.clipsContent = true;
    const v = SKV(); if (v) r.setBoundVariable("visible", v); else r.visible = false;
    return r;
  };
  var fillP = (node, presetName) => { const v = PR(presetName); if (v) node.fills = [paint(v)]; };
  var frame = (name, dir) => {
    const f = figma.createFrame(); f.name = name; f.fills = [];
    if (dir) { f.layoutMode = dir; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; }
    return f;
  };
  var text = (chars, size, bold, color) => {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Semi Bold" : "Regular" };
    t.characters = chars; t.fontSize = size; fill(t, color);
    return t;
  };
  var pad = (node, v) => ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach((p) => bind(node, p, v));
  var radius = (node, corners, v) => corners.forEach((c) => bind(node, c + "Radius", v));
  var ALL = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

  var NAME = "Tessera · Components";
  var page = figma.root.children.find((p) => p.name === NAME);
  if (page) { await page.loadAsync(); page.children.forEach((n) => n.remove()); } else { page = figma.createPage(); page.name = NAME; }
  await figma.setCurrentPageAsync(page);

  // ================= Контролы =================
  var STATES = ["default", "hover", "pressed", "disabled"];
  var stateOpacity = { hover: "opacity/10", pressed: "opacity/20" };
  var cursorY = 0;
  var failures = [];
  var fail = (name, e) => {
    failures.push(name);
    say(`✗ ${name}: ${(e && e.message) || e}`);
    try { const t = text(`✗ ${name}: ${(e && e.message) || e}`, 20, true, "content/status-negative/primary"); t.y = cursorY; page.appendChild(t); cursorY += 60; } catch (_) {}
  };
  var place = (set, title) => {
    const h = text(title, 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    set.x = 0; set.y = cursorY + 56; cursorY = set.y + set.height + 160;
  };
  var makeSlot = (comp, name, parent, key) => {
    const sl = comp.createSlot(); sl.name = name; sl.fills = [];
    sl.layoutMode = "HORIZONTAL"; sl.primaryAxisSizingMode = "AUTO"; sl.counterAxisSizingMode = "AUTO";
    sl.counterAxisAlignItems = "CENTER";
    try { parent.appendChild(sl); } catch (e) { say(`⚠ слот ${name}: ${e.message}`); }
    return sl;
  };
  var stateLayer = (comp, state, colorName) => {
    if (!stateOpacity[state]) return;
    const r = figma.createRectangle(); r.name = "state"; fill(r, colorName);
    comp.appendChild(r); r.layoutPositioning = "ABSOLUTE"; r.x = 0; r.y = 0; r.resize(comp.width, comp.height);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    bind(r, "opacity", N(stateOpacity[state]));
  };
  var combine = (comps, name, description) => {
    const set = figma.combineAsVariants(comps, page);
    set.name = name; set.description = description;
    return set;
  };

  // ================= Icon: библиотека иконок =================
  // Каждая иконка — компонент Icon/<имя>, 24×24, один вектор «glyph» с обводкой 2.
  // Цвет задаётся переопределением обводки glyph у инстанса — при замене иконки он сохраняется.
  var circ = (cx, cy, r) => { const k = 0.5523 * r; return `M ${cx - r} ${cy} C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} Z`; };
  var ICON_PATHS = {
    plus: "M 6 12 L 18 12 M 12 6 L 12 18",
    minus: "M 6 12 L 18 12",
    close: "M 7 7 L 17 17 M 17 7 L 7 17",
    check: "M 6 12.5 L 10 16.5 L 18 8",
    "chevron-down": "M 7 10 L 12 15 L 17 10",
    "chevron-up": "M 7 14 L 12 9 L 17 14",
    "chevron-left": "M 14 7 L 9 12 L 14 17",
    "chevron-right": "M 10 7 L 15 12 L 10 17",
    "arrow-left": "M 19 12 L 5 12 M 11 6 L 5 12 L 11 18",
    search: circ(10.5, 10.5, 6.5) + " M 15.5 15.5 L 20 20",
    eye: "M 2.5 12 C 5 7 8.5 5 12 5 C 15.5 5 19 7 21.5 12 C 19 17 15.5 19 12 19 C 8.5 19 5 17 2.5 12 Z " + circ(12, 12, 3),
    calendar: "M 5 5 L 19 5 L 19 20 L 5 20 Z M 5 10 L 19 10 M 8 3 L 8 7 M 16 3 L 16 7",
    info: circ(12, 12, 9) + " M 12 11 L 12 16 M 12 8 L 12 8.01",
    alert: "M 12 7 L 12 13 M 12 17 L 12 17.01",
    more: "M 6 12 L 6 12.01 M 12 12 L 12 12.01 M 18 12 L 18 12.01",
    heart: "M 12 20 C 12 20 3.5 14.5 3.5 9 C 3.5 6.2 5.6 4.5 8 4.5 C 9.7 4.5 11.1 5.4 12 6.8 C 12.9 5.4 14.3 4.5 16 4.5 C 18.4 4.5 20.5 6.2 20.5 9 C 20.5 14.5 12 20 12 20 Z",
    cart: "M 3 4 L 6 4 L 8 15 L 18 15 L 20 7 L 7 7 " + circ(9, 19, 1) + " " + circ(17, 19, 1),
    user: circ(12, 8, 4) + " M 4 20 C 4 16.5 7.5 14 12 14 C 16.5 14 20 16.5 20 20",
    home: "M 4 11 L 12 4 L 20 11 L 20 20 L 4 20 Z",
  };
  var ICONS = {};
  try {
    const iconHeader = text("Icon", 32, true, "content/neutral/primary"); iconHeader.y = cursorY; page.appendChild(iconHeader);
    let ix = 0;
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const c = figma.createComponent(); c.name = `Icon/${name}`; c.resize(24, 24); c.fills = [];
      const g = figma.createVector(); g.name = "glyph"; g.vectorPaths = [{ windingRule: "NONE", data: d }];
      g.fills = []; const v = T("content/neutral/primary"); if (v) g.strokes = [paint(v)];
      g.strokeWeight = 2; g.strokeCap = "ROUND"; g.strokeJoin = "ROUND";
      c.appendChild(g); g.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      c.description = `Иконка ${name}. Цвет — обводка слоя glyph у инстанса.`;
      c.x = ix; c.y = cursorY + 56; ix += 48;
      ICONS[name] = c;
    }
    cursorY += 56 + 24 + 120;
    say(`✓ Icon: ${Object.keys(ICONS).length} иконок`);
  } catch (e) { fail("Icon", e); }
  var ICON_ALIAS = { chevron: "chevron-down", clear: "close" };
  // Инстанс иконки нужного цвета; если библиотеки нет — пустой фрейм 24×24.
  var icon = (name, colorName, size) => {
    const comp = ICONS[ICON_ALIAS[name] || name];
    let n;
    if (comp) {
      n = comp.createInstance();
      const g = n.findOne((x) => x.name === "glyph"); const v = T(colorName);
      if (g && v) g.strokes = [paint(v)];
    } else { n = figma.createFrame(); n.fills = []; n.resize(24, 24); }
    if (size) n.resize(size, size);
    return n;
  };

  // ================= Skeleton и Text =================
  // Skeleton: заглушка загрузки — line (полоса по высоте строки), rect, circle.
  var skeletonSet = null;
  try {
    const comps = [];
    [["line", 240, 20], ["rect", 120, 80], ["circle", 40, 40]].forEach(([shape, w, h], ci) => {
      const c = figma.createComponent(); c.name = `shape=${shape}`; c.resize(w, h); c.fills = [];
      const r = figma.createRectangle(); r.name = "fill"; fill(r, "background/neutral-soft");
      c.appendChild(r);
      if (shape === "line") { r.resize(w, h * 0.6); r.x = 0; r.y = h * 0.2; r.cornerRadius = 6; r.constraints = { horizontal: "STRETCH", vertical: "SCALE" }; }
      else { r.resize(w, h); r.x = 0; r.y = 0; r.cornerRadius = shape === "circle" ? 999 : 12; r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" }; }
      c.x = ci * 280; comps.push(c);
    });
    skeletonSet = combine(comps, "Skeleton", "Заглушка загрузки: line — полоса по высоте строки (60% высоты, вложена в Text), rect, circle. Цвет background/neutral-soft. Обычно показывается модом коллекции «6 · Skeleton». Контракт: kb/components/skeleton.json.");
    const h = text("Skeleton", 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    skeletonSet.x = 0; skeletonSet.y = cursorY + 56; cursorY = skeletonSet.y + skeletonSet.height + 160;
    say("✓ Skeleton: line / rect / circle");
  } catch (e) { fail("Skeleton", e); }

  // Text: семантический текст. style × tone. Внутри — Skeleton/line: при моде Skeleton = on текст скрывается, видна полоса.
  try {
    const STYLES = [["display", "Bold"], ["title-l", "Bold"], ["title-m", "Semi Bold"], ["title-s", "Semi Bold"],
                    ["body-l", "Regular"], ["body-m", "Regular"], ["body-s", "Regular"], ["caption", "Medium"]];
    const TONES = ["primary", "secondary", "tertiary"];
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    const comps = [], labels = [];
    const line = skeletonSet && skeletonSet.children.find((c) => c.name === "shape=line");
    const SKC = V("Skeleton", "content"), SKV2 = V("Skeleton", "visible");
    STYLES.forEach(([st, weight], r) => TONES.forEach((tone, ci) => {
      const c = figma.createComponent(); c.name = `style=${st}, tone=${tone}`;
      c.layoutMode = "VERTICAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED"; c.resize(320, 20); c.fills = [];
      const t = figma.createText(); t.fontName = { family: "Inter", style: weight };
      t.characters = st.startsWith("body") || st === "caption" ? "Семантический текст: стиль и тон берутся из токенов" : "Заголовок";
      t.name = "text"; fill(t, `content/neutral/${tone}`);
      c.appendChild(t); t.layoutSizingHorizontal = "FILL"; t.textAutoResize = "HEIGHT";
      bind(t, "fontSize", VP(`text/${st}/font-size`)); bind(t, "lineHeight", VP(`text/${st}/line-height`));
      if (SKC) t.setBoundVariable("visible", SKC);
      if (line) {
        const sk = line.createInstance(); sk.name = "skeleton"; c.appendChild(sk);
        sk.layoutSizingHorizontal = "FILL"; bind(sk, "height", VP(`text/${st}/line-height`));
        if (SKV2) sk.setBoundVariable("visible", SKV2); else sk.visible = false;
      }
      c.x = ci * 360; c.y = r * 90; comps.push(c); labels.push(t);
    }));
    const set = combine(comps, "Text", "Семантический текст. style: display, title-l/m/s, body-l/m/s, caption — кегль и интерлиньяж из viewport/text/* (меняются по брейкпоинтам). tone: primary / secondary / tertiary (content/neutral/*). Внутри Skeleton/line: при моде Skeleton = on текст скрывается, показывается полоса высотой в строку. Контракт: kb/components/text.json.");
    const k = set.addComponentProperty("text", "TEXT", "Семантический текст");
    labels.forEach((l) => (l.componentPropertyReferences = { characters: k }));
    const h = text("Text", 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    set.x = 0; set.y = cursorY + 56; cursorY = set.y + set.height + 160;
    say(`✓ Text: ${comps.length} вариантов (style × tone), со скелетоном`);
  } catch (e) { fail("Text", e); }

  // ---- Button: смысл × контраст × размер × состояние

  var labelColor = (m, c) => m === "inverse" ? "content/inverse/primary"
    : m === "static-light" ? "content/static-dark"
    : m === "static-dark" ? "content/static-light"
    : c === "deep" ? `content/${m}/on-deep` : `content/${m}/primary`;
  try {
  // Набор на группу смысла × размер: Button/accent/large. Внутри варианты scheme (uno/duo…) × contrast × state.
  var GROUPS = [["neutral", [null]], ["accent", ["uno", "duo"]], ["status", ["positive", "negative"]],
                  ["brand", ["uno", "duo"]], ["static", ["light", "dark"]], ["inverse", [null]]];
  var meaningOf = (g, sc) => (sc ? `${g}-${sc}` : g);
  var SIZES = { s: "small", m: "medium", l: "large" };
  var buttonSets = {};
  var btnTotal = 0;
  var btnHeader = text("Button", 32, true, "content/neutral/primary"); btnHeader.y = cursorY; page.appendChild(btnHeader);
  var rowY = cursorY + 56;
  for (const [g, schemes] of GROUPS) {
    let x = 0, rowH = 0;
    for (const size of ["s", "m", "l"]) {
      const comps = [], labels = [], slots = [], icons = [];
      let r = 0;
      for (const sc of schemes) {
        const m = meaningOf(g, sc);
        for (const c of (g === "inverse" || g === "static" ? ["deep"] : ["pale", "deep"])) {
          STATES.forEach((state, ci) => {
            const b = figma.createComponent();
            b.name = (sc ? `scheme=${sc}, ` : "") + `contrast=${c}, state=${state}`;
            b.layoutMode = "HORIZONTAL"; b.primaryAxisSizingMode = "AUTO"; b.counterAxisSizingMode = "FIXED";
            b.primaryAxisAlignItems = "CENTER"; b.counterAxisAlignItems = "CENTER"; b.clipsContent = true;
            fill(b, g === "inverse" ? "background/inverse" : g === "static" ? `background/${m}` : `background/${m}-${c}`);
            b.resize(120, 44); bind(b, "height", VP(`control/${size}/height`));
            ["paddingLeft", "paddingRight"].forEach((p) => bind(b, p, VP(`control/${size}/padding-x`)));
            bind(b, "itemSpacing", VP(`control/${size}/gap`));
            radius(b, ALL, VP(`control/${size}/radius`));
            const lc = labelColor(m, c);
            const lead = makeSlot(b, "leading", b);
            const ic = icon("plus", lc, { s: 16, m: 20, l: 24 }[size]); ic.name = "icon"; b.appendChild(ic);
            const label = text("Кнопка", 15, true, lc); label.name = "label"; b.appendChild(label);
            bind(label, "fontSize", VP(`control/${size}/font-size`));
            const trail = makeSlot(b, "trailing", b);
            stateLayer(b, state, lc);
            if (state === "disabled") bind(b, "opacity", N("opacity/40"));
            skeletonOverlay(b);
            b.x = ci * 150; b.y = r * 76;
            comps.push(b); labels.push(label); slots.push([lead, trail]); icons.push(ic);
          });
          r++;
        }
      }
      const set = combine(comps, `Button/${g}/${SIZES[size]}`,
        `Кнопка ${g}, ${SIZES[size]}. Варианты: ` + (schemes[0] ? `scheme (${schemes.join(" / ")}) × ` : "") +
        "contrast (pale — второстепенная, deep — главная) × state. Свойства: label, hasLabel, hasIcon, icon (иконка из Icon/*), слоты leading / trailing. Только иконка: hasIcon = да, hasLabel = нет. Контракт: kb/components/button.json.");
      const lk = set.addComponentProperty("label", "TEXT", "Кнопка");
      const hl = set.addComponentProperty("hasLabel", "BOOLEAN", true);
      const hi = set.addComponentProperty("hasIcon", "BOOLEAN", false);
      let ik = null;
      try { if (ICONS.plus) ik = set.addComponentProperty("icon", "INSTANCE_SWAP", ICONS.plus.id, { preferredValues: Object.values(ICONS).map((c) => ({ type: "COMPONENT", key: c.key })) }); }
      catch (e) { try { ik = set.addComponentProperty("icon", "INSTANCE_SWAP", ICONS.plus.id); } catch (e2) { say(`⚠ icon swap: ${e2.message}`); } }
      const ld = set.addComponentProperty("leading", "BOOLEAN", false);
      const tr = set.addComponentProperty("trailing", "BOOLEAN", false);
      labels.forEach((l) => (l.componentPropertyReferences = { characters: lk, visible: hl }));
      icons.forEach((ic) => (ic.componentPropertyReferences = ik ? { visible: hi, mainComponent: ik } : { visible: hi }));
      slots.forEach(([l, t]) => { try { l.componentPropertyReferences = { visible: ld }; t.componentPropertyReferences = { visible: tr }; } catch (e) { say(`⚠ слоты кнопки: ${e.message}`); } });
      set.x = x; set.y = rowY; x += set.width + 80; rowH = Math.max(rowH, set.height);
      buttonSets[`${g}/${size}`] = { set, labelKey: lk, hasLabelKey: hl, hasIconKey: hi, iconKey: ik };
      btnTotal += comps.length;
    }
    rowY += rowH + 80;
  }
  cursorY = rowY + 80;
  say(`✓ Button: ${Object.keys(buttonSets).length} наборов (группа × размер), ${btnTotal} вариантов`);

  } catch (e) { fail("Button", e); }
  var buttonInstance = (meaning, contrast, size, label, opt) => {
    const [g, sc] = meaning.includes("-") ? meaning.split("-") : [meaning, null];
    const bs = buttonSets[`${g}/${size}`];
    const name = (sc ? `scheme=${sc}, ` : "") + `contrast=${contrast}, state=default`;
    const inst = bs.set.children.find((c) => c.name === name).createInstance();
    const props = { [bs.labelKey]: label };
    if (opt && opt.icon) {
      props[bs.hasIconKey] = true;
      const ic = ICONS[ICON_ALIAS[opt.icon] || opt.icon];
      if (bs.iconKey && ic) props[bs.iconKey] = ic.id;
      if (opt.iconOnly) props[bs.hasLabelKey] = false;
    }
    inst.setProperties(props);
    if (opt && opt.iconOnly) { inst.paddingLeft = inst.paddingRight = { s: 8, m: 12, l: 16 }[size]; }
    return inst;
  };  try {
  // ---- Checkbox и Radio
  function selector(kind, value, state) {
    const comp = figma.createComponent();
    comp.name = `${kind === "checkbox" ? "checked" : "selected"}=${value}, state=${state}`;
    comp.layoutMode = "HORIZONTAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "AUTO";
    comp.counterAxisAlignItems = "CENTER"; comp.fills = [];
    const hit = frame("hit", "HORIZONTAL"); hit.primaryAxisAlignItems = "CENTER"; hit.counterAxisAlignItems = "CENTER";
    hit.primaryAxisSizingMode = "FIXED"; hit.counterAxisSizingMode = "FIXED"; hit.resize(36, 36);
    comp.appendChild(hit);
    if (stateOpacity[state]) {
      const halo = figma.createEllipse(); halo.name = "state"; fill(halo, "content/neutral/primary");
      hit.appendChild(halo); halo.layoutPositioning = "ABSOLUTE"; halo.resize(36, 36); halo.x = 0; halo.y = 0;
      bind(halo, "opacity", N(stateOpacity[state]));
    }
    const on = value !== "false";
    const box = figma.createFrame(); box.name = "box"; box.resize(24, 24);
    bind(box, "width", VP("control/selector/size")); bind(box, "height", VP("control/selector/size"));
    if (kind === "checkbox") radius(box, ALL, VP("control/selector/checkbox-radius")); else box.cornerRadius = 999;
    // Мягкий стиль: без обводок. Выключен — серая заливка, включён — чёрный.
    // Радио включено — толстое чёрное кольцо с белым центром; чекбокс включён — чёрный с белой галкой.
    if (!on) fill(box, "background/neutral-soft");
    else if (kind === "checkbox") fill(box, "background/neutral-deep");
    else {
      fill(box, "ground/ground-2");
      const v = T("background/neutral-deep");
      if (v) { box.strokes = [paint(v)]; box.strokeAlign = "INSIDE"; bind(box, "strokeWeight", VP("control/selector/ring")); }
    }
    hit.appendChild(box);
    if (kind === "checkbox" && value === "true") {
      const mark = figma.createVector(); mark.name = "check";
      mark.vectorPaths = [{ windingRule: "NONE", data: "M 6.5 12.5 L 10.5 16.5 L 17.5 8" }];
      mark.fills = []; const v = T("content/neutral/on-deep"); if (v) mark.strokes = [paint(v)];
      mark.strokeWeight = 2.5; mark.strokeCap = "ROUND"; mark.strokeJoin = "ROUND";
      box.appendChild(mark); mark.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    }
    if (kind === "checkbox" && value === "indeterminate") {
      const dash = figma.createRectangle(); dash.name = "dash"; dash.resize(12, 2.5); dash.x = 6; dash.y = 10.75; dash.cornerRadius = 1.25;
      fill(dash, "content/neutral/on-deep"); box.appendChild(dash); dash.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    }
    if (state === "disabled") bind(comp, "opacity", N("opacity/40"));
    return { comp };
  }
  for (const [kind, values, title] of [["checkbox", ["false", "true", "indeterminate"], "Checkbox"], ["radio", ["false", "true"], "Radio"]]) {
    const comps = [];
    values.forEach((v, r) => STATES.forEach((s, c) => {
      const { comp } = selector(kind, v, s); comp.x = c * 60; comp.y = r * 56; comps.push(comp);
    }));
    const set = combine(comps, title, kind === "checkbox"
      ? "Чекбокс. Мягкий стиль: выключенный — серый без обводки, отмеченный — чёрный с белой галкой. Контракт: kb/components/checkbox.json."
      : "Радио. Мягкий стиль: выключенное — серое, выбранное — толстое чёрное кольцо. Контракт: kb/components/radio.json.");
    place(set, title);
    say(`✓ ${title}: ${comps.length} вариантов`);
  }

  } catch (e) { fail("Checkbox и Radio", e); }
  try {
  // ---- Chip
  var chipComps = [], chipLabels = [], chipSlots = [];
  ["false", "true"].forEach((sel, r) => STATES.forEach((state, c) => {
    const ch = figma.createComponent(); ch.name = `selected=${sel}, state=${state}`;
    ch.layoutMode = "HORIZONTAL"; ch.primaryAxisSizingMode = "AUTO"; ch.counterAxisSizingMode = "FIXED";
    ch.primaryAxisAlignItems = "CENTER"; ch.counterAxisAlignItems = "CENTER"; ch.clipsContent = true;
    ch.resize(80, 36); bind(ch, "height", VP("control/chip/height"));
    ["paddingLeft", "paddingRight"].forEach((p) => bind(ch, p, VP("control/chip/padding-x")));
    bind(ch, "itemSpacing", VP("control/m/gap")); radius(ch, ALL, VP("control/chip/radius"));
    const on = sel === "true";
    const lc = on ? "content/neutral/on-deep" : "content/neutral/primary";
    if (on) fill(ch, "background/neutral-deep");
    else fillP(ch, "chip/fill");
    const lead = makeSlot(ch, "leading", ch);
    const label = text("Чипс", 15, true, lc); label.name = "label"; ch.appendChild(label);
    bind(label, "fontSize", VP("control/m/font-size"));
    const trail = makeSlot(ch, "trailing", ch);
    stateLayer(ch, state, lc);
    if (state === "disabled") bind(ch, "opacity", N("opacity/40"));
    skeletonOverlay(ch);
    ch.x = c * 160; ch.y = r * 60;
    chipComps.push(ch); chipLabels.push(label); chipSlots.push([lead, trail]);
  }));
  var chipSet = combine(chipComps, "Chip", "Чипс: фильтр или выбор, без обводки. Невыбранный — preset/chip/fill (серый; в пресете overlay — белый), выбранный — чёрный. Контракт: kb/components/chip.json.");
  var chLk = chipSet.addComponentProperty("label", "TEXT", "Чипс");
  var chLead = chipSet.addComponentProperty("leading", "BOOLEAN", false);
  var chTrail = chipSet.addComponentProperty("trailing", "BOOLEAN", false);
  chipLabels.forEach((l) => (l.componentPropertyReferences = { characters: chLk }));
  chipSlots.forEach(([l, t]) => { try { l.componentPropertyReferences = { visible: chLead }; t.componentPropertyReferences = { visible: chTrail }; } catch (e) {} });
  place(chipSet, "Chip");
  say(`✓ Chip: ${chipComps.length} вариантов`);


  } catch (e) { fail("Chip", e); }
  try {
  // ---- RichIcon: набор на смысл × размер, варианты contrast × shape
  var glyph = (sizeVar, colorName) => {
    const box = figma.createFrame(); box.name = "icon"; box.fills = []; box.resize(20, 20);
    bind(box, "width", VP(sizeVar)); bind(box, "height", VP(sizeVar));
    const v = figma.createVector(); v.name = "glyph";
    v.vectorPaths = [{ windingRule: "NONZERO", data: "M 12 3 L 14 10 L 21 12 L 14 14 L 12 21 L 10 14 L 3 12 L 10 10 Z" }];
    v.resize(20, 20); fill(v, colorName); box.appendChild(v);
    v.x = 0; v.y = 0; v.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    return box;
  };
  // Один компонент RichIcon: варианты size × shape. Цвет — по умолчанию нейтральный, меняется заливкой и цветом иконки.
  var riHeader = text("RichIcon", 32, true, "content/neutral/primary"); riHeader.y = cursorY; page.appendChild(riHeader);
  var riComps = [];
  var SHAPES = ["circle", "rounded", "square"];
  ["s", "m", "l"].forEach((size, r) => SHAPES.forEach((shape, ci) => {
    const comp = figma.createComponent(); comp.name = `size=${SIZES[size]}, shape=${shape}`;
    comp.layoutMode = "HORIZONTAL"; comp.primaryAxisSizingMode = "FIXED"; comp.counterAxisSizingMode = "FIXED";
    comp.primaryAxisAlignItems = "CENTER"; comp.counterAxisAlignItems = "CENTER"; comp.clipsContent = true;
    comp.resize(40, 40);
    bind(comp, "width", VP(`rich-icon/${size}/size`)); bind(comp, "height", VP(`rich-icon/${size}/size`));
    fill(comp, "background/neutral-soft");
    if (shape === "circle") comp.cornerRadius = 999;
    else if (shape === "rounded") radius(comp, ALL, VP(`rich-icon/${size}/radius`));
    else comp.cornerRadius = 0;
    const sl = makeSlot(comp, "icon", comp);
    sl.appendChild(glyph(`rich-icon/${size}/icon`, "content/neutral/primary"));
    skeletonOverlay(comp);
    comp.x = ci * 80; comp.y = r * 80; riComps.push(comp);
  }));
  var riSet = combine(riComps, "RichIcon", "Иконка в подложке. Варианты: size (small 32 / medium 40 / large 48) × shape (circle, rounded, square). Цвет по умолчанию нейтральный (background/neutral-soft + content/neutral/primary) — меняйте заливку и цвет иконки на любой из Theme. Слот icon. Контракт: kb/components/rich-icon.json.");
  riSet.x = 0; riSet.y = cursorY + 56; cursorY = riSet.y + riSet.height + 160;
  say(`✓ RichIcon: ${riComps.length} вариантов (size × shape)`);

  } catch (e) { fail("RichIcon", e); }
  try {
  // ---- Navbar: наборы default и large, варианты surface
  var navHeader = text("Navbar", 32, true, "content/neutral/primary"); navHeader.y = cursorY; page.appendChild(navHeader);
  var navY = cursorY + 56;
  for (const kind of ["default", "large"]) {
    const comps = [], dividers = [];
    ["ground", "island", "transparent"].forEach((surface, r) => {
      const fg = surface === "transparent" ? "content/static-light" : "content/neutral/primary";
      const comp = figma.createComponent(); comp.name = `surface=${surface}`;
      comp.layoutMode = "VERTICAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "FIXED";
      comp.resize(390, 56); bind(comp, "width", VP("screen/width"));
      if (surface === "ground") fill(comp, "ground/ground-1");
      else if (surface === "island") fill(comp, "ground/ground-2");
      else comp.fills = [];
      const bar = frame("bar", "HORIZONTAL"); bar.counterAxisAlignItems = "CENTER";
      bar.counterAxisSizingMode = "FIXED"; bar.resize(390, 56); bind(bar, "height", VP("navbar/height"));
      ["paddingLeft", "paddingRight"].forEach((p) => bind(bar, p, VP("navbar/padding-x")));
      bind(bar, "itemSpacing", VP("navbar/gap"));
      comp.appendChild(bar); bar.layoutSizingHorizontal = "FILL";
      const left = makeSlot(comp, "left", bar);
      const back = text("←", 24, false, fg); back.name = "back"; left.appendChild(back);
      const center = makeSlot(comp, "center", bar); center.layoutSizingHorizontal = "FILL"; center.primaryAxisAlignItems = "CENTER";
      if (kind === "default") {
        const title = text("Заголовок", 17, true, fg); title.name = "title"; title.textAlignHorizontal = "CENTER";
        bind(title, "fontSize", VP("navbar/title-size")); center.appendChild(title);
      }
      const right = makeSlot(comp, "right", bar);
      const more = text("⋯", 24, false, fg); more.name = "action"; right.appendChild(more);
      if (kind === "large") {
        const tb = frame("large-title", "HORIZONTAL");
        ["paddingLeft", "paddingRight"].forEach((p) => bind(tb, p, VP("navbar/large-title-padding")));
        tb.paddingBottom = 12;
        const lt = text("Большой заголовок", 30, true, fg); lt.name = "title";
        bind(lt, "fontSize", VP("navbar/large-title-size")); tb.appendChild(lt);
        comp.appendChild(tb); tb.layoutSizingHorizontal = "FILL";
      }
      const div = figma.createRectangle(); div.name = "divider"; fill(div, "border/neutral/pale");
      comp.appendChild(div); div.layoutPositioning = "ABSOLUTE"; div.resize(comp.width, 1); div.x = 0; div.y = comp.height - 1;
      div.constraints = { horizontal: "STRETCH", vertical: "MAX" };
      comp.x = 0; comp.y = r * (kind === "large" ? 180 : 110);
      comps.push(comp); dividers.push(div);
    });
    const set = combine(comps, `Navbar/${kind}`, kind === "default"
      ? "Верхняя панель: слоты left / center (заголовок) / right. Варианты surface: ground, island, transparent (поверх фото). Ширина и высота — по Viewport. Контракт: kb/components/navbar.json."
      : "Верхняя панель с крупным заголовком под ней. Слоты left / center / right. Варианты surface. Контракт: kb/components/navbar.json.");
    const dk = set.addComponentProperty("divider", "BOOLEAN", false);
    dividers.forEach((d) => (d.componentPropertyReferences = { visible: dk }));
    set.x = 0; set.y = navY; navY += set.height + 80;
  }
  cursorY = navY + 100;
  say("✓ Navbar: наборы default и large × surface ground / island / transparent");

  } catch (e) { fail("Navbar", e); }
  try {
  // ================= Поля ввода =================
  // Кнопка внутри поля — инстанс Button/static (light, pale, small): белая на сером поле.
  var fieldBtn = (iconName, label) => {
    try {
      return iconName ? buttonInstance("static-light", "deep", "s", "", { icon: iconName, iconOnly: true }) : buttonInstance("static-light", "deep", "s", label);
    } catch (e) { say(`⚠ кнопка в поле: ${e.message}`); return iconName ? icon(iconName, "content/neutral/primary") : text(label, 16, true, "content/neutral/primary"); }
  };

  // Одно поле = отдельный набор компонентов (state × 5). Содержимое слотов кладётся прямо в компонент.
  var FIELD_STATES = ["empty", "focus", "filled", "error", "disabled"];
  var buildField = (setName, opt) => {
    const parts = [];
    const comps = FIELD_STATES.map((state, i) => {
      const comp = figma.createComponent(); comp.name = `state=${state}`;
      comp.layoutMode = "VERTICAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "FIXED";
      comp.resize(343, 56); bind(comp, "width", VP("field/width")); comp.fills = [];
      bind(comp, "itemSpacing", VP("field/hint-gap"));
      const box = frame("field", "HORIZONTAL"); box.counterAxisAlignItems = "CENTER";
      box.counterAxisSizingMode = "FIXED"; box.resize(343, 56);
      comp.appendChild(box); box.layoutSizingHorizontal = "FILL";
      bind(box, "height", VP("field/height"));
      ["paddingLeft", "paddingRight"].forEach((p) => bind(box, p, VP("field/padding-x")));
      bind(box, "itemSpacing", VP("field/gap")); radius(box, ALL, VP("field/radius"));
      fillP(box, "field/fill");
      if (state === "error") { const v = T("background/status-negative-deep"); if (v) { box.strokes = [paint(v)]; box.strokeAlign = "INSIDE"; box.strokeWeight = 1.5; } }
      const lead = makeSlot(comp, "leading", box);
      if (opt.leading) lead.appendChild(opt.leading());
      const col = frame("text", "VERTICAL"); col.primaryAxisAlignItems = "CENTER";
      box.appendChild(col); col.layoutSizingHorizontal = "FILL";
      ["paddingLeft", "paddingRight"].forEach((p) => bind(col, p, VP("field/text-padding-x")));
      bind(col, "itemSpacing", VP("field/label-gap"));
      const raised = state !== "empty";
      const label = text(opt.label, raised ? 13 : 16, false, state === "error" ? "content/status-negative/primary" : (raised ? "content/neutral/secondary" : "content/neutral/tertiary"));
      label.fontName = { family: "Inter", style: "Medium" }; label.name = "label"; bind(label, "fontSize", VP(raised ? "field/label-size" : "field/value-size"));
      col.appendChild(label); label.layoutSizingHorizontal = "FILL";
      const valueRow = frame("value-row", "HORIZONTAL"); valueRow.counterAxisAlignItems = "CENTER"; valueRow.itemSpacing = 1;
      col.appendChild(valueRow);
      const value = text(opt.value, 16, false, "content/neutral/primary"); value.name = "value";
      bind(value, "fontSize", VP("field/value-size")); valueRow.appendChild(value);
      if (state === "focus") { const caret = figma.createRectangle(); caret.name = "caret"; caret.resize(2, 20); fill(caret, "content/neutral/primary"); valueRow.appendChild(caret); value.visible = false; }
      if (state === "empty") valueRow.visible = false;
      const trail = makeSlot(comp, "trailing", box);
      if (opt.trailing) trail.appendChild(opt.trailing());
      skeletonOverlay(box);
      const hint = text(state === "error" ? "Проверьте значение" : (opt.hint || "Подсказка"), 13, false, state === "error" ? "content/status-negative/primary" : "content/neutral/secondary");
      hint.name = "hint"; bind(hint, "fontSize", VP("field/hint-size"));
      comp.appendChild(hint); hint.layoutSizingHorizontal = "FILL";
      if (state === "disabled") bind(comp, "opacity", N("opacity/40"));
      comp.x = i * 400; comp.y = 0;
      parts.push({ label, value, hint, lead, trail });
      return comp;
    });
    const set = combine(comps, setName, opt.description);
    const k = {
      label: set.addComponentProperty("label", "TEXT", opt.label),
      value: set.addComponentProperty("value", "TEXT", opt.value),
      hasHint: set.addComponentProperty("hasHint", "BOOLEAN", !!opt.hint),
      leading: set.addComponentProperty("leading", "BOOLEAN", !!opt.leading),
      trailing: set.addComponentProperty("trailing", "BOOLEAN", !!opt.trailing),
    };
    parts.forEach(({ label, value, hint, lead, trail }) => {
      label.componentPropertyReferences = { characters: k.label };
      value.componentPropertyReferences = { characters: k.value };
      hint.componentPropertyReferences = { visible: k.hasHint };
      try { lead.componentPropertyReferences = { visible: k.leading }; trail.componentPropertyReferences = { visible: k.trailing }; } catch (e) { say(`⚠ слоты ${setName}: ${e.message}`); }
    });
    return set;
  };

  var fieldHeader = text("Field", 32, true, "content/neutral/primary"); fieldHeader.y = cursorY; page.appendChild(fieldHeader);
  var fieldY = cursorY + 56;
  var FIELDS = [
    ["Field", { label: "Лейбл", value: "Значение", description: "Поле ввода: серая заливка, плавающий лейбл, пустые слоты leading / trailing, подсказка. Состояния: empty, focus, filled, error (красная обводка и лейбл), disabled. Контракт: kb/components/field.json." }],
    ["Field/password", { label: "Пароль", value: "••••••••", hint: "Минимум 8 символов", trailing: () => fieldBtn("eye"), description: "Пароль: значение точками, справа кнопка-иконка «показать» (Button/static light pale small)." }],
    ["Field/number", { label: "Количество", value: "2", description: "Число: справа белые кнопки − и +.", trailing: () => {
        const g = frame("stepper", "HORIZONTAL"); g.itemSpacing = 6;
        g.appendChild(fieldBtn("minus"));
        g.appendChild(fieldBtn("plus"));
        return g; } }],
    ["Field/search", { label: "Найти", value: "Пицца", leading: () => icon("search", "content/neutral/secondary"), trailing: () => icon("clear", "content/neutral/secondary"), description: "Поиск: слева лупа, справа контурный крестик — очистить." }],
    ["Field/select", { label: "Город", value: "Москва", trailing: () => fieldBtn("chevron-down"), description: "Выбор из списка: справа кнопка-иконка с шевроном (Button)." }],
    ["Field/phone", { label: "Телефон", value: "900 000-00-00", leading: () => fieldBtn(null, "+7"), description: "Телефон: код страны в кнопке слева (Button)." }],
    ["Field/date", { label: "Дата доставки", value: "12 ноября", trailing: () => fieldBtn("calendar"), description: "Дата: справа кнопка-иконка с календарём (Button)." }],
  ];
  var builtFields = [];
  for (const [name, opt] of FIELDS) {
    try {
      const set = buildField(name, opt);
      set.x = 0; set.y = fieldY; fieldY += set.height + 60;
      builtFields.push(name);
    } catch (e) { fail(name, e); }
  }
  cursorY = fieldY + 100;
  say(`✓ Поля: ${builtFields.join(", ")}`);

  // ---- Switch: checked × state. Включённый — чёрный, как остальные контролы.
  try {
    const swComps = [];
    ["false", "true"].forEach((on, r) => ["default", "disabled"].forEach((state, ci) => {
      const comp = figma.createComponent(); comp.name = `checked=${on}, state=${state}`;
      comp.layoutMode = "HORIZONTAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "AUTO";
      comp.counterAxisAlignItems = "CENTER"; comp.fills = [];
      const track = frame("track", "HORIZONTAL"); track.counterAxisAlignItems = "CENTER";
      track.primaryAxisAlignItems = on === "true" ? "MAX" : "MIN";
      track.primaryAxisSizingMode = "FIXED"; track.counterAxisSizingMode = "FIXED"; track.resize(52, 32);
      comp.appendChild(track);
      bind(track, "width", VP("control/switch/width")); bind(track, "height", VP("control/switch/height"));
      ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach((p) => bind(track, p, VP("control/switch/inset")));
      track.cornerRadius = 999;
      fill(track, on === "true" ? "background/neutral-deep" : "background/neutral-soft");
      const knob = figma.createEllipse(); knob.name = "knob"; knob.resize(28, 28);
      track.appendChild(knob);
      bind(knob, "width", VP("control/switch/knob")); bind(knob, "height", VP("control/switch/knob"));
      fill(knob, "ground/ground-2");
      skeletonOverlay(track);
      if (state === "disabled") bind(comp, "opacity", N("opacity/40"));
      comp.x = ci * 80; comp.y = r * 56; swComps.push(comp);
    }));
    const swSet = combine(swComps, "Switch", "Свитч. Выключенный — серый трек, включённый — чёрный, ручка белая. Контракт: kb/components/switch.json.");
    const h = text("Switch", 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    swSet.x = 0; swSet.y = cursorY + 56; cursorY = swSet.y + swSet.height + 160;
    say("✓ Switch: 4 варианта");
  } catch (e) { fail("Switch", e); }

  // ---- Textarea: многострочное поле той же анатомии, что Field
  try {
    const parts = [];
    const comps = FIELD_STATES.map((state, i) => {
      const comp = figma.createComponent(); comp.name = `state=${state}`;
      comp.layoutMode = "VERTICAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "FIXED";
      comp.resize(343, 120); bind(comp, "width", VP("field/width")); comp.fills = [];
      bind(comp, "itemSpacing", VP("field/hint-gap"));
      const box = frame("field", "VERTICAL"); box.primaryAxisSizingMode = "AUTO";
      comp.appendChild(box); box.layoutSizingHorizontal = "FILL";
      bind(box, "minHeight", VP("field/textarea-min-height"));
      ["paddingLeft", "paddingRight"].forEach((p) => bind(box, p, VP("field/padding-x")));
      ["paddingTop", "paddingBottom"].forEach((p) => bind(box, p, VP("field/padding-y")));
      radius(box, ALL, VP("field/radius")); fillP(box, "field/fill");
      if (state === "error") { const v = T("background/status-negative-deep"); if (v) { box.strokes = [paint(v)]; box.strokeAlign = "INSIDE"; box.strokeWeight = 1.5; } }
      const col = frame("text", "VERTICAL"); box.appendChild(col); col.layoutSizingHorizontal = "FILL"; col.layoutSizingVertical = "FILL";
      ["paddingLeft", "paddingRight"].forEach((p) => bind(col, p, VP("field/text-padding-x")));
      bind(col, "itemSpacing", VP("field/label-gap"));
      const raised = state !== "empty";
      const label = text("Комментарий", raised ? 13 : 16, false, state === "error" ? "content/status-negative/primary" : (raised ? "content/neutral/secondary" : "content/neutral/tertiary"));
      label.fontName = { family: "Inter", style: "Medium" }; label.name = "label";
      bind(label, "fontSize", VP(raised ? "field/label-size" : "field/value-size"));
      col.appendChild(label); label.layoutSizingHorizontal = "FILL";
      const value = text("Позвоните за 10 минут до приезда, домофон не работает", 16, false, "content/neutral/primary"); value.name = "value";
      bind(value, "fontSize", VP("field/value-size"));
      col.appendChild(value); value.layoutSizingHorizontal = "FILL"; value.textAutoResize = "HEIGHT";
      if (state === "empty") value.visible = false;
      if (state === "focus") value.characters = "|";
      const counter = text("54 / 500", 13, false, "content/neutral/tertiary"); counter.name = "counter"; counter.textAlignHorizontal = "RIGHT";
      bind(counter, "fontSize", VP("field/hint-size"));
      col.appendChild(counter); counter.layoutSizingHorizontal = "FILL";
      const hint = text(state === "error" ? "Слишком длинный комментарий" : "Подсказка", 13, false, state === "error" ? "content/status-negative/primary" : "content/neutral/secondary");
      hint.name = "hint"; bind(hint, "fontSize", VP("field/hint-size"));
      comp.appendChild(hint); hint.layoutSizingHorizontal = "FILL";
      if (state === "disabled") bind(comp, "opacity", N("opacity/40"));
      comp.x = i * 400; parts.push({ label, value, counter, hint });
      return comp;
    });
    const set = combine(comps, "Textarea", "Многострочное поле: та же анатомия, что Field — серая заливка, лейбл Medium, ошибка красной обводкой. Растёт по высоте от viewport/field/textarea-min-height. Счётчик символов справа внизу. Контракт: kb/components/textarea.json.");
    const k = {
      label: set.addComponentProperty("label", "TEXT", "Комментарий"),
      value: set.addComponentProperty("value", "TEXT", "Позвоните за 10 минут до приезда, домофон не работает"),
      counter: set.addComponentProperty("counter", "TEXT", "54 / 500"),
      hasCounter: set.addComponentProperty("hasCounter", "BOOLEAN", true),
      hasHint: set.addComponentProperty("hasHint", "BOOLEAN", false),
    };
    parts.forEach(({ label, value, counter, hint }) => {
      label.componentPropertyReferences = { characters: k.label };
      if (value.characters !== "|") value.componentPropertyReferences = { characters: k.value };
      counter.componentPropertyReferences = { characters: k.counter, visible: k.hasCounter };
      hint.componentPropertyReferences = { visible: k.hasHint };
    });
    const h = text("Textarea", 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    set.x = 0; set.y = cursorY + 56; cursorY = set.y + set.height + 160;
    say("✓ Textarea: 5 состояний");
  } catch (e) { fail("Textarea", e); }

  // ---- Segmented control: серый трек, выбранный сегмент — белая плашка.
  try {
    const segItems = [];
    ["false", "true"].forEach((sel, i) => {
      const c = figma.createComponent(); c.name = `selected=${sel}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED";
      c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER"; c.resize(100, 36);
      ["paddingLeft", "paddingRight"].forEach((p) => bind(c, p, VP("segment/padding-x")));
      radius(c, ALL, VP("segment/item-radius"));
      if (sel === "true") fillP(c, "segment/selected"); else c.fills = [];
      const l = text("Сегмент", 14, false, sel === "true" ? "content/neutral/primary" : "content/neutral/secondary");
      l.fontName = { family: "Inter", style: sel === "true" ? "Semi Bold" : "Medium" }; l.name = "label";
      bind(l, "fontSize", VP("segment/font-size")); c.appendChild(l);
      c.x = i * 140; segItems.push({ c, l });
    });
    const segItemSet = combine(segItems.map((x) => x.c), "Segmented control/item", "Сегмент: selected — белая плашка с полужирной подписью.");
    const segLabel = segItemSet.addComponentProperty("label", "TEXT", "Сегмент");
    segItems.forEach(({ l }) => (l.componentPropertyReferences = { characters: segLabel }));
    const segOn = segItemSet.children.find((c) => c.name === "selected=true");
    const segOff = segItemSet.children.find((c) => c.name === "selected=false");
    const comps = [];
    [2, 3, 4].forEach((count, r) => {
      const c = figma.createComponent(); c.name = `items=${count}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED"; c.counterAxisAlignItems = "CENTER";
      c.resize(343, 40); bind(c, "width", VP("segment/width")); bind(c, "height", VP("segment/height"));
      ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach((p) => bind(c, p, VP("segment/inset")));
      radius(c, ALL, VP("segment/radius")); fillP(c, "segment/track");
      c.clipsContent = true;
      const labels = ["Доставка", "Самовывоз", "В зале", "Ещё"];
      for (let i = 0; i < count; i++) {
        const inst = (i === 0 ? segOn : segOff).createInstance();
        c.appendChild(inst); inst.layoutSizingHorizontal = "FILL"; inst.layoutSizingVertical = "FILL";
        inst.setProperties({ [segLabel]: labels[i] });
        try { inst.isExposedInstance = true; } catch (e) {}
      }
      skeletonOverlay(c);
      c.y = r * 60 + 100; comps.push(c);
    });
    const set = combine(comps, "Segmented control", "Сегментированный контрол в стиле Яндекса: серый трек, выбранный сегмент — белая плашка. Варианты items: 2, 3, 4. Выбор — свойство selected у вложенных сегментов (они открыты в свойствах). Контракт: kb/components/segmented-control.json.");
    const h = text("Segmented control", 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    segItemSet.x = 0; segItemSet.y = cursorY + 56;
    set.x = 0; set.y = segItemSet.y + segItemSet.height + 40; cursorY = set.y + set.height + 160;
    say("✓ Segmented control: items 2 / 3 / 4");
  } catch (e) { fail("Segmented control", e); }

  // ================= Пакет: Badge, Stepper, Tab bar, Divider, Snackbar, Spinner, Progress, Code input, Pagination =================
  var section = (title, set) => { const h = text(title, 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h); set.x = 0; set.y = cursorY + 56; cursorY = set.y + set.height + 160; };
  var shadow = (node) => { node.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0, visible: true, blendMode: "NORMAL" }]; };

  // ---- Badge: type (dot / number) × tone (negative / accent / neutral)
  try {
    const comps = [], labels = [];
    const TONES = [["negative", "status-negative"], ["accent", "accent-uno"], ["neutral", "neutral"]];
    TONES.forEach(([tone, m], r) => ["dot", "number"].forEach((type, ci) => {
      const c = figma.createComponent(); c.name = `type=${type}, tone=${tone}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER"; c.cornerRadius = 999;
      fill(c, `background/${m}-deep`);
      if (type === "dot") {
        c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED"; c.resize(8, 8);
        bind(c, "width", VP("badge/dot")); bind(c, "height", VP("badge/dot"));
      } else {
        c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED"; c.resize(20, 20);
        bind(c, "height", VP("badge/height")); bind(c, "minWidth", VP("badge/height"));
        ["paddingLeft", "paddingRight"].forEach((p) => bind(c, p, VP("badge/padding-x")));
        const l = text("3", 12, true, `content/${m}/on-deep`); l.name = "count"; bind(l, "fontSize", VP("badge/font-size")); c.appendChild(l); labels.push(l);
      }
      c.x = ci * 60; c.y = r * 40; comps.push(c);
    }));
    const set = combine(comps, "Badge", "Бейдж: точка или счётчик. tone: negative (красный), accent, neutral (чёрный). Контракт: kb/components/badge.json.");
    const k = set.addComponentProperty("count", "TEXT", "3");
    labels.forEach((l) => (l.componentPropertyReferences = { characters: k }));
    section("Badge", set); say("✓ Badge");
  } catch (e) { fail("Badge", e); }

  // ---- Stepper: size × state. Серый трек (пресет поля), белые кнопки − +.
  try {
    const comps = [], vals = [];
    ["s", "m", "l"].forEach((size, r) => ["default", "min", "disabled"].forEach((state, ci) => {
      const c = figma.createComponent(); c.name = `size=${SIZES[size]}, state=${state}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED"; c.counterAxisAlignItems = "CENTER";
      c.resize(120, 40); bind(c, "height", VP(`stepper/${size}/height`)); c.cornerRadius = 999; c.clipsContent = true;
      fillP(c, "field/fill");
      const btn = (iconName, dim) => {
        const b = frame(iconName, "HORIZONTAL"); b.primaryAxisAlignItems = "CENTER"; b.counterAxisAlignItems = "CENTER";
        b.primaryAxisSizingMode = "FIXED"; b.counterAxisSizingMode = "FIXED"; b.resize(40, 40); b.cornerRadius = 999;
        bind(b, "width", VP(`stepper/${size}/button`)); bind(b, "height", VP(`stepper/${size}/button`));
        b.appendChild(icon(iconName, "content/neutral/primary")); if (dim) bind(b, "opacity", N("opacity/40"));
        return b;
      };
      c.appendChild(btn("minus", state === "min"));
      const v = text(state === "min" ? "1" : "2", 16, true, "content/neutral/primary"); v.name = "value"; v.textAlignHorizontal = "CENTER";
      bind(v, "fontSize", VP("stepper/font-size")); c.appendChild(v); bind(v, "minWidth", VP("stepper/value-width"));
      c.appendChild(btn("plus", false));
      if (state === "disabled") bind(c, "opacity", N("opacity/40"));
      skeletonOverlay(c);
      c.x = ci * 180; c.y = r * 64; comps.push(c); vals.push(v);
    }));
    const set = combine(comps, "Stepper", "Степпер количества: − число +. Трек — preset/field/fill (на цветном фоне белый). state: default, min (минус приглушён), disabled. Контракт: kb/components/stepper.json.");
    const k = set.addComponentProperty("value", "TEXT", "2");
    vals.forEach((v) => (v.componentPropertyReferences = { characters: k }));
    section("Stepper", set); say("✓ Stepper");
  } catch (e) { fail("Stepper", e); }

  // ---- Tab bar: плавающая круглая капсула. Tab bar/item (active) + Tab bar (items 3/4/5)
  try {
    const itemComps = [], itemLabels = [], itemBadges = [];
    ["false", "true"].forEach((act, ci) => {
      const c = figma.createComponent(); c.name = `active=${act}`;
      c.layoutMode = "VERTICAL"; c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER";
      c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED"; c.resize(72, 52); c.cornerRadius = 999;
      ["paddingTop", "paddingBottom"].forEach((p) => bind(c, p, VP("tabbar/item-padding-y")));
      bind(c, "itemSpacing", VP("tabbar/gap"));
      if (act === "true") fill(c, "background/neutral-soft"); else c.fills = [];
      const color = act === "true" ? "content/neutral/primary" : "content/neutral/tertiary";
      const slot = makeSlot(c, "icon", c);
      slot.appendChild(glyph("tabbar/icon", color));
      const badge = figma.createEllipse(); badge.name = "badge"; badge.resize(8, 8); fill(badge, "background/status-negative-deep");
      c.appendChild(badge); badge.layoutPositioning = "ABSOLUTE"; badge.x = 42; badge.y = 6;
      const l = text("Главная", 11, true, color); l.name = "label"; bind(l, "fontSize", VP("tabbar/label-size")); c.appendChild(l);
      c.x = ci * 100; itemComps.push(c); itemLabels.push(l); itemBadges.push(badge);
    });
    const itemSet = combine(itemComps, "Tab bar/item", "Таб плавающей панели: иконка (слот) + подпись. Активный — в серой капсуле background/neutral-soft, остальные — content/neutral/tertiary. badge — точка.");
    const lk = itemSet.addComponentProperty("label", "TEXT", "Главная");
    const bk = itemSet.addComponentProperty("badge", "BOOLEAN", false);
    itemLabels.forEach((l) => (l.componentPropertyReferences = { characters: lk }));
    itemBadges.forEach((b) => (b.componentPropertyReferences = { visible: bk }));
    const on = itemSet.children.find((c) => c.name === "active=true"), off = itemSet.children.find((c) => c.name === "active=false");
    const names = ["Главная", "Каталог", "Корзина", "Заказы", "Профиль"];
    const comps = [];
    [3, 4, 5].forEach((count, r) => {
      const c = figma.createComponent(); c.name = `items=${count}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "AUTO"; c.fills = [];
      c.resize(390, 80); bind(c, "width", VP("screen/width"));
      ["paddingLeft", "paddingRight", "paddingBottom"].forEach((p) => bind(c, p, VP("tabbar/margin")));
      const capsule = frame("capsule", "HORIZONTAL"); capsule.counterAxisAlignItems = "CENTER"; capsule.cornerRadius = 999;
      capsule.counterAxisSizingMode = "FIXED"; capsule.resize(360, 64);
      c.appendChild(capsule); capsule.layoutSizingHorizontal = "FILL";
      bind(capsule, "height", VP("tabbar/height"));
      ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach((p) => bind(capsule, p, VP("tabbar/inset")));
      fill(capsule, "ground/ground-2"); shadow(capsule);
      for (let i = 0; i < count; i++) {
        const inst = (i === 0 ? on : off).createInstance(); capsule.appendChild(inst);
        inst.layoutSizingHorizontal = "FILL"; inst.layoutSizingVertical = "FILL";
        inst.setProperties({ [lk]: names[i] });
        try { inst.isExposedInstance = true; } catch (e) {}
      }
      c.y = r * 100; comps.push(c);
    });
    const set = combine(comps, "Tab bar", "Нижняя навигация — плавающая круглая капсула с тенью, отступ от краёв viewport/tabbar/margin. items 3 / 4 / 5. Активный таб — свойство active у вложенных табов. Контракт: kb/components/tab-bar.json.");
    section("Tab bar", itemSet); section("", set); say("✓ Tab bar");
  } catch (e) { fail("Tab bar", e); }


  // ---- Divider: line / line-inset / section
  try {
    const comps = [];
    [["line", "border/neutral/pale", "divider/line", false], ["inset", "border/neutral/pale", "divider/line", true], ["section", "ground/ground-1", "divider/section", false]].forEach(([type, color, h, inset], r) => {
      const c = figma.createComponent(); c.name = `type=${type}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "AUTO"; c.resize(375, 1); c.fills = [];
      if (inset) bind(c, "paddingLeft", VP("divider/inset"));
      const line = figma.createRectangle(); line.name = "line"; fill(line, color); line.resize(375, 1); c.appendChild(line);
      line.layoutSizingHorizontal = "FILL"; bind(line, "height", VP(h));
      c.y = r * 30; comps.push(c);
    });
    const set = combine(comps, "Divider", "Разделитель: line — тонкая линия, inset — с отступом слева (в списках), section — толстый разделитель секций цвета страницы. Контракт: kb/components/divider.json.");
    section("Divider", set); say("✓ Divider");
  } catch (e) { fail("Divider", e); }

  // ---- Snackbar: тёмная плашка с крупным скруглением, заголовок + описание, действие, закрыть
  try {
    const comps = [], parts = [];
    [["default", null], ["success", "status-positive"], ["error", "status-negative"]].forEach(([tone, m], r) => {
      const c = figma.createComponent(); c.name = `tone=${tone}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "AUTO"; c.counterAxisAlignItems = "CENTER";
      c.resize(343, 60); bind(c, "width", VP("snackbar/width"));
      ["paddingLeft", "paddingRight"].forEach((p) => bind(c, p, VP("snackbar/padding-x")));
      ["paddingTop", "paddingBottom"].forEach((p) => bind(c, p, VP("snackbar/padding-y")));
      bind(c, "itemSpacing", VP("snackbar/gap")); radius(c, ALL, VP("snackbar/radius"));
      fill(c, "background/inverse"); shadow(c);
      const lead = makeSlot(c, "icon", c);
      if (m) {
        const b = frame("status", "HORIZONTAL"); b.primaryAxisAlignItems = "CENTER"; b.counterAxisAlignItems = "CENTER";
        b.primaryAxisSizingMode = "FIXED"; b.counterAxisSizingMode = "FIXED"; b.resize(28, 28); b.cornerRadius = 999; fill(b, `background/${m}-deep`);
        b.appendChild(icon(tone === "success" ? "check" : "alert", `content/${m}/on-deep`)); lead.appendChild(b);
      } else lead.appendChild(icon("info", "content/inverse/primary"));
      const col = frame("text", "VERTICAL"); col.itemSpacing = 2; c.appendChild(col); col.layoutSizingHorizontal = "FILL";
      const title = text(tone === "error" ? "Не удалось оформить заказ" : tone === "success" ? "Заказ оформлен" : "Добавлено в корзину", 15, true, "content/inverse/primary");
      title.name = "title"; col.appendChild(title); title.layoutSizingHorizontal = "FILL"; title.textAutoResize = "HEIGHT";
      const desc = text(tone === "error" ? "Проверьте соединение и попробуйте ещё раз" : "Курьер приедет через 25–35 минут", 13, false, "content/inverse/secondary");
      desc.name = "description"; col.appendChild(desc); desc.layoutSizingHorizontal = "FILL"; desc.textAutoResize = "HEIGHT";
      let act;
      try { act = buttonInstance("static-light", "deep", "s", "Отменить"); }
      catch (e) { act = frame("action", "HORIZONTAL"); act.appendChild(text("Отменить", 14, true, "content/inverse/primary")); }
      act.name = "action"; c.appendChild(act);
      const close = icon("clear", "content/inverse/secondary"); close.name = "close"; c.appendChild(close);
      c.y = r * 100; comps.push(c); parts.push({ lead, title, desc, act, close });
    });
    const set = combine(comps, "Snackbar", "Снэкбар: тёмная плашка background/inverse, скругление 20, тень. Заголовок + описание, кнопка действия (белая) и закрыть. tone: default (иконка), success, error (значок в цветном круге). Контракт: kb/components/snackbar.json.");
    const k = { title: set.addComponentProperty("title", "TEXT", "Добавлено в корзину"), desc: set.addComponentProperty("description", "TEXT", "Курьер приедет через 25–35 минут"),
      hasDesc: set.addComponentProperty("hasDescription", "BOOLEAN", true), hasAct: set.addComponentProperty("hasAction", "BOOLEAN", true),
      hasClose: set.addComponentProperty("hasClose", "BOOLEAN", false), hasIcon: set.addComponentProperty("hasIcon", "BOOLEAN", true) };
    parts.forEach(({ lead, title, desc, act, close }) => {
      title.componentPropertyReferences = { characters: k.title };
      desc.componentPropertyReferences = { characters: k.desc, visible: k.hasDesc };
      act.componentPropertyReferences = { visible: k.hasAct }; close.componentPropertyReferences = { visible: k.hasClose };
      try { lead.componentPropertyReferences = { visible: k.hasIcon }; } catch (e) {}
    });
    section("Snackbar", set); say("✓ Snackbar");
  } catch (e) { fail("Snackbar", e); }

  // ---- Spinner: тонкая дуга 270° со скруглёнными концами, без трека
  try {
    const comps = [];
    [["neutral", "content/neutral/primary"], ["on-deep", "content/neutral/on-deep"]].forEach(([tone, color], r) => ["s", "m", "l"].forEach((size, ci) => {
      const c = figma.createComponent(); c.name = `size=${SIZES[size]}, tone=${tone}`; c.resize(24, 24);
      bind(c, "width", VP(`spinner/${size}`)); bind(c, "height", VP(`spinner/${size}`));
      if (tone === "on-deep") fill(c, "background/neutral-deep"); else c.fills = [];
      const arc = figma.createVector(); arc.name = "arc";
      arc.vectorPaths = [{ windingRule: "NONE", data: "M 12 2 C 17.52 2 22 6.48 22 12 C 22 17.52 17.52 22 12 22 C 6.48 22 2 17.52 2 12" }];
      arc.fills = []; const v = T(color); if (v) arc.strokes = [paint(v)];
      arc.strokeCap = "ROUND"; c.appendChild(arc); arc.x = 2; arc.y = 2;
      bind(arc, "strokeWeight", VP(`spinner/stroke-${size}`));
      arc.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      c.x = ci * 64; c.y = r * 64; comps.push(c);
    }));
    const set = combine(comps, "Spinner", "Спиннер: тонкая дуга 270° со скруглёнными концами, без трека. size small 16 / medium 24 / large 40, tone neutral | on-deep. В коде — вращение. Контракт: kb/components/spinner.json.");
    section("Spinner", set); say("✓ Spinner");
  } catch (e) { fail("Spinner", e); }


  // ---- Progress bar: value 0 / 25 / 50 / 75 / 100
  try {
    const comps = [];
    [0, 25, 50, 75, 100].forEach((val, r) => {
      const c = figma.createComponent(); c.name = `value=${val}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED"; c.resize(343, 4);
      bind(c, "width", VP("progress/width")); bind(c, "height", VP("progress/height")); c.cornerRadius = 999; c.clipsContent = true;
      fill(c, "background/neutral-soft");
      const bar = figma.createRectangle(); bar.name = "value"; fill(bar, "background/neutral-deep"); bar.cornerRadius = 999;
      c.appendChild(bar); bar.layoutPositioning = "ABSOLUTE"; bar.x = 0; bar.y = 0; bar.resize(Math.max(343 * val / 100, 0.01), 4);
      bar.constraints = { horizontal: "SCALE", vertical: "STRETCH" }; if (val === 0) bar.visible = false;
      c.y = r * 24; comps.push(c);
    });
    const set = combine(comps, "Progress bar", "Прогресс-бар: серый трек, чёрное заполнение. value 0 / 25 / 50 / 75 / 100 — заполнение масштабируется с шириной. Контракт: kb/components/progress-bar.json.");
    section("Progress bar", set); say("✓ Progress bar");
  } catch (e) { fail("Progress bar", e); }

  // ---- Code input: ячейка (state) + поле кода (length 4 / 6 × state)
  try {
    const cellComps = [], digits = [];
    ["empty", "active", "filled", "error"].forEach((state, ci) => {
      const c = figma.createComponent(); c.name = `state=${state}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER";
      c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED"; c.resize(48, 56);
      bind(c, "width", VP("code/cell-width")); bind(c, "height", VP("code/cell-height")); radius(c, ALL, VP("code/radius"));
      fillP(c, "field/fill");
      if (state === "error") { const v = T("background/status-negative-deep"); if (v) { c.strokes = [paint(v)]; c.strokeAlign = "INSIDE"; c.strokeWeight = 1.5; } }
      if (state === "active") { const caret = figma.createRectangle(); caret.name = "caret"; caret.resize(2, 24); fill(caret, "content/neutral/primary"); c.appendChild(caret); }
      else { const d = text(state === "empty" ? "" : "7", 24, true, state === "error" ? "content/status-negative/primary" : "content/neutral/primary"); d.name = "digit"; bind(d, "fontSize", VP("code/font-size")); c.appendChild(d); if (state !== "empty") digits.push(d); }
      c.x = ci * 70; cellComps.push(c);
    });
    const cellSet = combine(cellComps, "Code input/cell", "Ячейка кода: empty, active (курсор), filled, error (красная обводка).");
    const dk = cellSet.addComponentProperty("digit", "TEXT", "7");
    digits.forEach((d) => (d.componentPropertyReferences = { characters: dk }));
    const cell = (st) => cellSet.children.find((c) => c.name === `state=${st}`);
    const comps = [];
    [4, 6].forEach((len, r) => ["empty", "filling", "filled", "error"].forEach((state, ci) => {
      const c = figma.createComponent(); c.name = `length=${len}, state=${state}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO"; c.fills = [];
      bind(c, "itemSpacing", VP("code/gap"));
      for (let i = 0; i < len; i++) {
        const st = state === "empty" ? (i === 0 ? "active" : "empty") : state === "filling" ? (i < 2 ? "filled" : i === 2 ? "active" : "empty") : state;
        const inst = cell(st).createInstance(); c.appendChild(inst);
        if (st === "filled" || st === "error") inst.setProperties({ [dk]: String((i * 3 + 4) % 10) });
        try { inst.isExposedInstance = true; } catch (e) {}
      }
      c.x = ci * 420; c.y = r * 80; comps.push(c);
    }));
    const set = combine(comps, "Code input", "Ввод кода из СМС по ячейкам: length 4 / 6; state empty, filling, filled, error. Ячейки — preset/field/fill. Контракт: kb/components/code-input.json.");
    section("Code input", cellSet); section("", set); say("✓ Code input");
  } catch (e) { fail("Code input", e); }

  // ---- Pagination: точки карусели
  try {
    const dotComps = [];
    ["false", "true"].forEach((act, ci) => {
      const c = figma.createComponent(); c.name = `active=${act}`; c.cornerRadius = 999; c.resize(6, 6);
      bind(c, "height", VP("pagination/dot")); bind(c, "width", VP(act === "true" ? "pagination/active-width" : "pagination/dot"));
      fill(c, act === "true" ? "background/neutral-deep" : "border/neutral/soft");
      c.x = ci * 40; dotComps.push(c);
    });
    const dotSet = combine(dotComps, "Pagination/dot", "Точка пагинации: активная — чёрная пилюля, остальные — серые точки.");
    const on = dotSet.children.find((c) => c.name === "active=true"), off = dotSet.children.find((c) => c.name === "active=false");
    const comps = [];
    [3, 4, 5, 6].forEach((count, r) => {
      const c = figma.createComponent(); c.name = `items=${count}`;
      c.layoutMode = "HORIZONTAL"; c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO"; c.counterAxisAlignItems = "CENTER"; c.fills = [];
      bind(c, "itemSpacing", VP("pagination/gap"));
      for (let i = 0; i < count; i++) { const inst = (i === 0 ? on : off).createInstance(); c.appendChild(inst); try { inst.isExposedInstance = true; } catch (e) {} }
      c.y = r * 24; comps.push(c);
    });
    const set = combine(comps, "Pagination", "Пагинация карусели: items 3–6, активная точка — свойство active у вложенной точки. Контракт: kb/components/pagination.json.");
    section("Pagination", dotSet); section("", set); say("✓ Pagination");
  } catch (e) { fail("Pagination", e); }

  // ================= /Поля ввода =================
  } catch (e) { fail("Поля", e); }
  // ================= /Поля ввода =================



  // ================= /Контролы =================

  function panelFor(type, root) {
    const panel = frame("panel", "VERTICAL");
    fill(panel, "ground/ground-2");
    pad(panel, VP("window/padding")); bind(panel, "itemSpacing", VP("window/gap"));
    panel.clipsContent = true;
    if (type === "dialog") radius(panel, ALL, VP("window/radius"));
    if (type === "bottom-sheet") radius(panel, ["topLeft", "topRight"], VP("window/radius"));
    if (type === "side-sheet") radius(panel, ["topLeft", "bottomLeft"], VP("window/radius"));
    if (type === "adaptive") {
      radius(panel, ["topLeft", "topRight"], VP("window/radius"));
      radius(panel, ["bottomLeft", "bottomRight"], VP("window/adaptive/bottom-radius"));
    }
    if (type === "bottom-sheet" || type === "adaptive") {
      const gw = frame("grabber", "HORIZONTAL"); gw.primaryAxisAlignItems = "CENTER";
      const g = figma.createRectangle(); g.name = "handle"; g.resize(36, 4); g.cornerRadius = 2; fill(g, "border/neutral/soft");
      gw.appendChild(g); panel.appendChild(gw); gw.layoutSizingHorizontal = "FILL";
      if (type === "adaptive") bind(gw, "visible", VP("window/adaptive/grabber"));
    }
    // Нативный слот Figma внутри компонента. Если вложить слот глубже корня нельзя — оставляем его в корне и сообщаем.
    const slot = (name, dir, parent) => {
      const sl = root.createSlot(); sl.name = name; sl.fills = [];
      sl.layoutMode = dir; sl.primaryAxisSizingMode = "AUTO"; sl.counterAxisSizingMode = "AUTO";
      sl.clipsContent = false;
      try { parent.appendChild(sl); } catch (e) { say(`⚠ слот ${name} нельзя вложить в ${parent.name}: ${e.message}`); }
      return sl;
    };

    // 1. Шапка: три слота — слева, по центру (заголовок), справа.
    const header = frame("header", "HORIZONTAL"); header.itemSpacing = 12; header.counterAxisAlignItems = "CENTER";
    panel.appendChild(header); header.layoutSizingHorizontal = "FILL";
    const left = slot("header-left", "HORIZONTAL", header); left.counterAxisAlignItems = "CENTER";
    const center = slot("header-center", "HORIZONTAL", header); center.counterAxisAlignItems = "CENTER";
    center.layoutSizingHorizontal = "FILL";
    const title = text("Заголовок окна", 18, true, "content/neutral/primary"); title.name = "title";
    center.appendChild(title); title.layoutSizingHorizontal = "FILL"; title.textAutoResize = "HEIGHT";
    const right = slot("header-right", "HORIZONTAL", header); right.counterAxisAlignItems = "CENTER";
    const close = text("×", 24, false, "content/neutral/secondary"); close.name = "close"; right.appendChild(close);

    // 2. Контент: слот.
    const content = slot("content", "VERTICAL", panel); content.itemSpacing = 8;
    content.layoutSizingHorizontal = "FILL";
    const body = text("Контент окна: текст, форма или список. Замените содержимое слота.", 15, false, "content/neutral/secondary");
    content.appendChild(body); body.layoutSizingHorizontal = "FILL"; body.textAutoResize = "HEIGHT";

    // 3. Футер: слот. По умолчанию — две кнопки во всю ширину, высота 56.
    const footer = slot("footer", "VERTICAL", panel); bind(footer, "itemSpacing", VP("window/footer-gap"));
    footer.layoutSizingHorizontal = "FILL";
    for (const [label, m, c] of [["Продолжить", "accent-uno", "deep"], ["Отмена", "neutral", "pale"]]) {
      let b;
      try { b = buttonInstance(m, c, "l", label); }
      catch (e) { // если кнопки не собрались — заглушка, чтобы окно всё равно появилось
        b = frame(`button · ${label}`, "HORIZONTAL"); b.primaryAxisAlignItems = "CENTER"; b.counterAxisAlignItems = "CENTER"; b.cornerRadius = 14;
        fill(b, c === "deep" ? `background/${m}-deep` : `background/${m}-pale`);
        b.appendChild(text(label, 16, true, c === "deep" ? `content/${m}/on-deep` : `content/${m}/primary`));
        b.counterAxisSizingMode = "FIXED"; b.resize(100, 56);
      }
      footer.appendChild(b); b.layoutSizingHorizontal = "FILL";
    }
    return { panel };
  }

  try {
  var variants = [];
  for (const type of ["dialog", "bottom-sheet", "side-sheet", "adaptive"]) {
    const root = figma.createComponent(); root.name = `type=${type}`; root.fills = [];
    root.layoutMode = type === "side-sheet" ? "HORIZONTAL" : "VERTICAL";
    root.primaryAxisSizingMode = "FIXED"; root.counterAxisSizingMode = "FIXED";
    root.counterAxisAlignItems = "CENTER"; root.clipsContent = true;
    root.resize(390, 844);
    bind(root, "width", VP("screen/width")); bind(root, "height", VP("screen/height"));
    const margin = type === "dialog" ? VP("window/margin") : type === "adaptive" ? VP("window/adaptive/margin") : null;
    if (margin) pad(root, margin);

    const scrim = figma.createRectangle(); scrim.name = "scrim"; fill(scrim, "ground/scrim");
    bind(scrim, "opacity", N("opacity/40"));
    const blocker = figma.createRectangle(); blocker.name = "blocker"; blocker.fills = [];
    for (const layer of [scrim, blocker]) {
      root.appendChild(layer); layer.layoutPositioning = "ABSOLUTE";
      layer.x = 0; layer.y = 0; layer.resize(390, 844); layer.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    }

    const before = frame("spacer-before"); before.layoutMode = "VERTICAL"; root.appendChild(before);
    const { panel } = panelFor(type, root);
    root.appendChild(panel);
    const after = frame("spacer-after"); after.layoutMode = "VERTICAL"; root.appendChild(after);
    if (type === "side-sheet") {
      before.layoutSizingHorizontal = "FILL"; before.layoutSizingVertical = "FILL";
      after.remove();
      panel.layoutSizingVertical = "FILL"; panel.layoutSizingHorizontal = "FIXED"; panel.resize(390, panel.height);
      bind(panel, "width", VP("window/side-width"));
    } else {
      before.layoutSizingVertical = "FILL"; after.layoutSizingVertical = "FILL";
      panel.layoutSizingHorizontal = "FILL";
      const maxW = { dialog: "window/dialog-max-width", "bottom-sheet": "window/sheet-max-width", adaptive: "window/adaptive/max-width" }[type];
      panel.maxWidth = 9999; bind(panel, "maxWidth", VP(maxW));
      if (type === "bottom-sheet") after.remove();
      if (type === "adaptive") bind(after, "visible", VP("window/adaptive/centered"));
    }
    variants.push({ root, scrim, blocker });
  }

  var set = figma.combineAsVariants(variants.map((v) => v.root), page);
  set.x = 0; set.y = cursorY + 56;
  set.name = "Window";
  var wh = text("Window", 32, true, "content/neutral/primary"); wh.y = cursorY; page.appendChild(wh);
  set.layoutMode = "HORIZONTAL"; set.itemSpacing = 80; set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 80;
  set.primaryAxisSizingMode = "AUTO"; set.counterAxisSizingMode = "AUTO";
  set.description = "Окно поверх страницы: dialog, bottom-sheet, side-sheet, adaptive (шит на s, диалог на m/l). modal — блокирует страницу, scrim — затемнение. Размеры и поведение — мод коллекции Viewport. Слоты: header-left, header-center, header-right, content, footer. Контракт: kb/components/window.json.";
  var modalKey = set.addComponentProperty("modal", "BOOLEAN", true);
  var scrimKey = set.addComponentProperty("scrim", "BOOLEAN", true);
  for (const v of variants) {
    v.blocker.componentPropertyReferences = { visible: modalKey };
    v.scrim.componentPropertyReferences = { visible: scrimKey };
  }
  say("✓ компонент Window: 4 вида, свойства modal / scrim, слоты header-left / header-center / header-right / content / footer");

  figma.viewport.scrollAndZoomIntoView(page.children);
  } catch (e) { fail("Window", e); }
  if (failures.length) say(`Не собралось: ${failures.join(", ")}. Остальное собрано.`);
}

const URL_KEY = "tessera.sourceUrl";

async function run(variables, checkPage, components) {
  log.length = 0;
  say(`${variables.kit} ${variables.version}`);
  const index = await syncVariables(variables);
  if (checkPage) await buildCheckPage(variables, index);
  if (components) await buildComponents(index);
  return log.join("\n");
}

async function fetchVariables(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now()); // без кэша
  if (!res.ok) throw new Error(`не удалось загрузить ${url}: ${res.status}`);
  return res.json();
}

function openUI(initialLog) {
  figma.showUI(__html__, { width: 360, height: 480 });
  figma.clientStorage.getAsync(URL_KEY).then((url) => figma.ui.postMessage({ url: url || "", log: initialLog || "" }));
  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === "save-url") { await figma.clientStorage.setAsync(URL_KEY, msg.url); figma.ui.postMessage({ log: "Ссылка сохранена." }); return; }
      if (msg.type === "sync-url") {
        await figma.clientStorage.setAsync(URL_KEY, msg.url);
        figma.ui.postMessage({ log: await run(await fetchVariables(msg.url), msg.checkPage, msg.components) });
        return;
      }
      if (msg.type === "sync") figma.ui.postMessage({ log: await run(msg.variables, msg.checkPage, msg.components) });
    } catch (e) { figma.ui.postMessage({ log: "✗ " + (e.message || e) + (log.length ? "\n" + log.join("\n") : "") }); }
  };
}

async function headless(checkPage, components) {
  const url = await figma.clientStorage.getAsync(URL_KEY);
  if (!url) { figma.notify("Сначала укажите ссылку на variables.json в «Настройки и загрузка файла…»"); figma.closePlugin(); return; }
  try {
    const out = await run(await fetchVariables(url), checkPage, components);
    if (components) { openUI(out); return; }
    const n = out.split("\n").find((l) => l.startsWith("⚠"));
    figma.closePlugin(n ? `Tessera обновлена, но ${n}` : "Tessera обновлена из репозитория ✓");
  } catch (e) { console.error(e); openUI("✗ " + (e.message || e) + (log.length ? "\n" + log.join("\n") : "")); }
}

if (figma.command === "update") headless(false);
else if (figma.command === "update-check") headless(true);
else if (figma.command === "update-components") headless(false, true);
else openUI("");
