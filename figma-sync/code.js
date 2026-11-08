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
        const under = lvl === "on-deep" ? `background/${m}-deep`
          : m === "static-light" ? "background/static-dark-deep"
          : m === "inverse" ? "background/inverse" : "ground/ground-2";
        fill(box, under); box.appendChild(text("Aa", 16, true, n));
      }));
      board.appendChild(ct.s);

      // border — обводка на острове
      const bd = section("border");
      for (const n of by("border")) bd.grid.appendChild(swatch(short(n), (box) => {
        fill(box, n.includes("static-light") ? "background/static-dark-deep" : n.endsWith("/inverse") ? "background/inverse" : "ground/ground-2");
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
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const col = (part) => cols.find((c) => c.name.includes(part));
  const V = (coll, name) => {
    const v = index[`${col(coll).name}::${name}`];
    if (!v) say(`⚠ нет переменной ${coll}::${name}`);
    return v;
  };
  const T = (n) => V("Theme", n), VP = (n) => V("Viewport", n), N = (n) => V("Numbers", n);
  const bind = (node, field, v) => { if (v) node.setBoundVariable(field, v); };
  const paint = (v) => figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }, "color", v);
  const fill = (node, themeName) => { const v = T(themeName); if (v) node.fills = [paint(v)]; };
  const frame = (name, dir) => {
    const f = figma.createFrame(); f.name = name; f.fills = [];
    if (dir) { f.layoutMode = dir; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; }
    return f;
  };
  const text = (chars, size, bold, color) => {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Semi Bold" : "Regular" };
    t.characters = chars; t.fontSize = size; fill(t, color);
    return t;
  };
  const pad = (node, v) => ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach((p) => bind(node, p, v));
  const radius = (node, corners, v) => corners.forEach((c) => bind(node, c + "Radius", v));
  const ALL = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

  const NAME = "Tessera · Components";
  let page = figma.root.children.find((p) => p.name === NAME);
  if (page) page.children.forEach((n) => n.remove()); else { page = figma.createPage(); page.name = NAME; }
  await figma.setCurrentPageAsync(page);

  // ================= Контролы =================
  const STATES = ["default", "hover", "pressed", "disabled"];
  const stateOpacity = { hover: "opacity/10", pressed: "opacity/20" };
  let cursorY = 0;
  const place = (set, title) => {
    const h = text(title, 32, true, "content/neutral/primary"); h.y = cursorY; page.appendChild(h);
    set.x = 0; set.y = cursorY + 56; cursorY = set.y + set.height + 160;
  };
  const makeSlot = (comp, name, parent, key) => {
    const sl = comp.createSlot(); sl.name = name; sl.fills = [];
    sl.layoutMode = "HORIZONTAL"; sl.primaryAxisSizingMode = "AUTO"; sl.counterAxisSizingMode = "AUTO";
    sl.counterAxisAlignItems = "CENTER";
    try { parent.appendChild(sl); } catch (e) { say(`⚠ слот ${name}: ${e.message}`); }
    return sl;
  };
  const stateLayer = (comp, state, colorName) => {
    if (!stateOpacity[state]) return;
    const r = figma.createRectangle(); r.name = "state"; fill(r, colorName);
    comp.appendChild(r); r.layoutPositioning = "ABSOLUTE"; r.x = 0; r.y = 0; r.resize(comp.width, comp.height);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    bind(r, "opacity", N(stateOpacity[state]));
  };
  const combine = (comps, name, description) => {
    const set = figma.combineAsVariants(comps, page);
    set.name = name; set.description = description;
    return set;
  };

  // ---- Button: смысл × контраст × размер × состояние
  const MEANINGS = ["neutral", "accent-uno", "accent-duo", "status-positive", "status-negative", "brand-uno", "brand-duo", "static-light", "static-dark", "inverse"];
  const labelColor = (m, c) => m === "inverse" ? "content/inverse/primary"
    : m === "static-light" ? "content/static-dark/primary"
    : m === "static-dark" ? "content/static-light/primary"
    : c === "deep" ? `content/${m}/on-deep` : `content/${m}/primary`;
  // Отдельный набор на каждое сочетание смысл × размер: Button/accent-uno/large.
  // Внутри набора варианты: contrast × state.
  const SIZES = { s: "small", m: "medium", l: "large" };
  const buttonSets = {};
  let btnTotal = 0;
  const btnRowStart = cursorY;
  const btnHeader = text("Button", 32, true, "content/neutral/primary"); btnHeader.y = cursorY; page.appendChild(btnHeader);
  let rowY = cursorY + 56;
  for (const m of MEANINGS) {
    let x = 0, rowH = 0;
    for (const size of ["s", "m", "l"]) {
      const comps = [], labels = [], slots = [];
      const contrasts = m === "inverse" ? ["deep"] : ["pale", "soft", "deep"];
      contrasts.forEach((c, r) => STATES.forEach((state, ci) => {
        const b = figma.createComponent();
        b.name = `contrast=${c}, state=${state}`;
        b.layoutMode = "HORIZONTAL"; b.primaryAxisSizingMode = "AUTO"; b.counterAxisSizingMode = "FIXED";
        b.primaryAxisAlignItems = "CENTER"; b.counterAxisAlignItems = "CENTER"; b.clipsContent = true;
        fill(b, m === "inverse" ? "background/inverse" : `background/${m}-${c}`);
        b.resize(120, 44); bind(b, "height", VP(`control/${size}/height`));
        ["paddingLeft", "paddingRight"].forEach((p) => bind(b, p, VP(`control/${size}/padding-x`)));
        bind(b, "itemSpacing", VP(`control/${size}/gap`));
        radius(b, ALL, VP(`control/${size}/radius`));
        const lc = labelColor(m, c);
        const lead = makeSlot(b, "leading", b);
        const label = text("Кнопка", 15, true, lc); label.name = "label"; b.appendChild(label);
        bind(label, "fontSize", VP(`control/${size}/font-size`));
        const trail = makeSlot(b, "trailing", b);
        stateLayer(b, state, lc);
        if (state === "disabled") bind(b, "opacity", N("opacity/40"));
        b.x = ci * 150; b.y = r * 76;
        comps.push(b); labels.push(label); slots.push([lead, trail]);
      }));
      const set = combine(comps, `Button/${m}/${SIZES[size]}`,
        `Кнопка ${m}, размер ${SIZES[size]}. Варианты: contrast (pale — тихая, soft — второстепенная, deep — главная) × state. Контракт: kb/components/button.json.`);
      const lk = set.addComponentProperty("label", "TEXT", "Кнопка");
      const ld = set.addComponentProperty("leading", "BOOLEAN", false);
      const tr = set.addComponentProperty("trailing", "BOOLEAN", false);
      labels.forEach((l) => (l.componentPropertyReferences = { characters: lk }));
      slots.forEach(([l, t]) => { try { l.componentPropertyReferences = { visible: ld }; t.componentPropertyReferences = { visible: tr }; } catch (e) { say(`⚠ слоты кнопки: ${e.message}`); } });
      set.x = x; set.y = rowY; x += set.width + 80; rowH = Math.max(rowH, set.height);
      buttonSets[`${m}/${size}`] = { set, labelKey: lk };
      btnTotal += comps.length;
    }
    rowY += rowH + 80;
  }
  cursorY = rowY + 80;
  say(`✓ Button: ${Object.keys(buttonSets).length} наборов (смысл × размер), ${btnTotal} вариантов`);

  // ---- Checkbox и Radio
  function selector(kind, value, state) {
    const comp = figma.createComponent();
    comp.name = `${kind === "checkbox" ? "checked" : "selected"}=${value}, state=${state}`;
    comp.layoutMode = "HORIZONTAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "AUTO";
    comp.counterAxisAlignItems = "CENTER"; comp.fills = [];
    bind(comp, "itemSpacing", VP("control/selector/gap"));
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
    const label = text("Подпись", 15, false, "content/neutral/primary"); label.name = "label"; comp.appendChild(label);
    bind(label, "fontSize", VP("control/m/font-size"));
    if (state === "disabled") bind(comp, "opacity", N("opacity/40"));
    return { comp, label };
  }
  for (const [kind, values, title] of [["checkbox", ["false", "true", "indeterminate"], "Checkbox"], ["radio", ["false", "true"], "Radio"]]) {
    const comps = [], labels = [];
    values.forEach((v, r) => STATES.forEach((s, c) => {
      const { comp, label } = selector(kind, v, s); comp.x = c * 180; comp.y = r * 56; comps.push(comp); labels.push(label);
    }));
    const set = combine(comps, title, kind === "checkbox"
      ? "Чекбокс. Мягкий стиль: выключенный — серый без обводки, отмеченный — чёрный с белой галкой. Контракт: kb/components/checkbox.json."
      : "Радио. Мягкий стиль: выключенное — серое, выбранное — толстое чёрное кольцо. Контракт: kb/components/radio.json.");
    const lk = set.addComponentProperty("label", "TEXT", "Подпись");
    const hk = set.addComponentProperty("hasLabel", "BOOLEAN", true);
    labels.forEach((l) => (l.componentPropertyReferences = { characters: lk, visible: hk }));
    place(set, title);
    say(`✓ ${title}: ${comps.length} вариантов`);
  }

  // ---- Chip
  const chipComps = [], chipLabels = [], chipSlots = [];
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
    else { fill(ch, "background/neutral-pale"); const v = T("border/neutral/soft"); if (v) { ch.strokes = [paint(v)]; ch.strokeWeight = 1; ch.strokeAlign = "INSIDE"; } }
    const lead = makeSlot(ch, "leading", ch);
    const label = text("Чипс", 15, true, lc); label.name = "label"; ch.appendChild(label);
    bind(label, "fontSize", VP("control/m/font-size"));
    const trail = makeSlot(ch, "trailing", ch);
    stateLayer(ch, state, lc);
    if (state === "disabled") bind(ch, "opacity", N("opacity/40"));
    ch.x = c * 160; ch.y = r * 60;
    chipComps.push(ch); chipLabels.push(label); chipSlots.push([lead, trail]);
  }));
  const chipSet = combine(chipComps, "Chip", "Чипс: фильтр или выбор. Выбранный — чёрный (background/neutral-deep). Контракт: kb/components/chip.json.");
  const chLk = chipSet.addComponentProperty("label", "TEXT", "Чипс");
  const chLead = chipSet.addComponentProperty("leading", "BOOLEAN", false);
  const chTrail = chipSet.addComponentProperty("trailing", "BOOLEAN", false);
  chipLabels.forEach((l) => (l.componentPropertyReferences = { characters: chLk }));
  chipSlots.forEach(([l, t]) => { try { l.componentPropertyReferences = { visible: chLead }; t.componentPropertyReferences = { visible: chTrail }; } catch (e) {} });
  place(chipSet, "Chip");
  say(`✓ Chip: ${chipComps.length} вариантов`);

  const buttonInstance = (meaning, contrast, size, label) => {
    const { set, labelKey } = buttonSets[`${meaning}/${size}`];
    const comp = set.children.find((c) => c.name === `contrast=${contrast}, state=default`);
    const inst = comp.createInstance();
    inst.setProperties({ [labelKey]: label });
    return inst;
  };
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
    for (const [label, m, c] of [["Продолжить", "accent-uno", "deep"], ["Отмена", "neutral", "soft"]]) {
      const b = buttonInstance(m, c, "l", label);
      footer.appendChild(b); b.layoutSizingHorizontal = "FILL";
    }
    return { panel };
  }

  const variants = [];
  for (const type of ["dialog", "bottom-sheet", "side-sheet", "adaptive"]) {
    const root = figma.createComponent(); root.name = `type=${type}`; root.fills = [];
    root.layoutMode = type === "side-sheet" ? "HORIZONTAL" : "VERTICAL";
    root.primaryAxisSizingMode = "FIXED"; root.counterAxisSizingMode = "FIXED";
    root.counterAxisAlignItems = "CENTER"; root.clipsContent = true;
    root.resize(390, 844);
    bind(root, "width", VP("screen/width")); bind(root, "height", VP("screen/height"));
    const margin = type === "dialog" ? VP("window/margin") : type === "adaptive" ? VP("window/adaptive/margin") : null;
    if (margin) pad(root, margin);

    const scrim = figma.createRectangle(); scrim.name = "scrim"; fill(scrim, "background/static-dark-deep");
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

  const set = figma.combineAsVariants(variants.map((v) => v.root), page);
  set.x = 0; set.y = cursorY + 56;
  set.name = "Window";
  const wh = text("Window", 32, true, "content/neutral/primary"); wh.y = cursorY; page.appendChild(wh);
  set.layoutMode = "HORIZONTAL"; set.itemSpacing = 80; set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 80;
  set.primaryAxisSizingMode = "AUTO"; set.counterAxisSizingMode = "AUTO";
  set.description = "Окно поверх страницы: dialog, bottom-sheet, side-sheet, adaptive (шит на s, диалог на m/l). modal — блокирует страницу, scrim — затемнение. Размеры и поведение — мод коллекции Viewport. Слоты: header-left, header-center, header-right, content, footer. Контракт: kb/components/window.json.";
  const modalKey = set.addComponentProperty("modal", "BOOLEAN", true);
  const scrimKey = set.addComponentProperty("scrim", "BOOLEAN", true);
  for (const v of variants) {
    v.blocker.componentPropertyReferences = { visible: modalKey };
    v.scrim.componentPropertyReferences = { visible: scrimKey };
  }
  say("✓ компонент Window: 4 вида, свойства modal / scrim, слоты header-left / header-center / header-right / content / footer");

  // Демо: каждый вид на трёх брейкпоинтах — инстансы с явным модом Viewport.
  const vpCol = col("Viewport");
  const grid = frame("Window · брейкпоинты", "VERTICAL"); grid.itemSpacing = 80;
  grid.paddingLeft = grid.paddingRight = grid.paddingTop = grid.paddingBottom = 80;
  for (const comp of set.children) {
    const row = frame(comp.name, "HORIZONTAL"); row.itemSpacing = 80; row.counterAxisAlignItems = "MIN";
    for (const mode of vpCol.modes) {
      const cell = frame(`${comp.name} · ${mode.name}`, "VERTICAL"); cell.itemSpacing = 16;
      cell.appendChild(text(`${comp.name.replace("type=", "")} · ${mode.name}`, 28, true, "content/neutral/primary"));
      const screen = frame("screen", "VERTICAL"); fill(screen, "ground/ground-1");
      const inst = comp.createInstance();
      screen.appendChild(inst);
      screen.setExplicitVariableModeForCollection(vpCol, mode.modeId);
      cell.appendChild(screen); row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  page.appendChild(grid); grid.y = set.y + set.height + 200; fill(grid, "ground/ground-1");
  figma.viewport.scrollAndZoomIntoView(page.children);
  say("✓ демо: 4 вида × 3 брейкпоинта на странице «Tessera · Components»");
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

async function headless(checkPage, components) {
  const url = await figma.clientStorage.getAsync(URL_KEY);
  if (!url) { figma.notify("Сначала укажите ссылку на variables.json в «Настройки и загрузка файла…»"); figma.closePlugin(); return; }
  try {
    const out = await run(await fetchVariables(url), checkPage, components);
    const n = out.split("\n").find((l) => l.startsWith("⚠"));
    figma.closePlugin(n ? `Tessera обновлена, но ${n}` : "Tessera обновлена из репозитория ✓");
  } catch (e) { figma.closePlugin("✗ " + (e.message || e)); }
}

if (figma.command === "update") headless(false);
else if (figma.command === "update-check") headless(true);
else if (figma.command === "update-components") headless(false, true);
else {
  figma.showUI(__html__, { width: 360, height: 440 });
  figma.clientStorage.getAsync(URL_KEY).then((url) => figma.ui.postMessage({ url: url || "" }));
  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === "save-url") { await figma.clientStorage.setAsync(URL_KEY, msg.url); figma.ui.postMessage({ log: "Ссылка сохранена." }); return; }
      if (msg.type === "sync-url") {
        await figma.clientStorage.setAsync(URL_KEY, msg.url);
        figma.ui.postMessage({ log: await run(await fetchVariables(msg.url), msg.checkPage, msg.components) });
        return;
      }
      if (msg.type === "sync") figma.ui.postMessage({ log: await run(msg.variables, msg.checkPage, msg.components) });
    } catch (e) { figma.ui.postMessage({ log: "✗ " + (e.message || e) }); }
  };
}
