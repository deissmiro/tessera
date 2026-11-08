#!/usr/bin/env python3
"""Палитра и цвет бренда.

    python3 tools/palette.py brands/<id>.brand.json [--check]

Пишет два файла:
  tokens/palette/<palette>.json — шкалы в коллекции «0 · Palette», названные по цвету (gray, violet, red, burgundy…);
                                  без модов, ни о брендах, ни о смыслах не знает;
  tokens/brand/<id>.json        — мод бренда в «1 · Brand»: ссылки на свою палитру + опорные цвета.
Палитра одна на бренд и общая для светлой и тёмной темы; тема только выбирает ступени.
Бренд может взять чужую палитру: "palette": "<id>" в brand.json.

Из цветов бренда строятся перцептивно ровные шкалы в OKLCH. Имя шкалы — по тону цвета
(переопределяется "names": {"accent-uno": "burgundy"} в brand.json). Смысл шкалам
(accent-uno, positive…) даёт слой Brand.
Ступени 50…950 имеют одинаковую светлоту у всех рамп и брендов. Исходный цвет
ставится точно в ближайшую ступень. Бренд берёт из каждой шкалы четыре тона:
pale, soft, pure (исходный цвет), deep — на них ссылается семантика.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from colorlib import hex_to_oklch, oklch_to_hex, contrast  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
LIGHTNESS = dict(zip(STEPS, [0.97, 0.935, 0.87, 0.79, 0.715, 0.625, 0.545, 0.465, 0.385, 0.305, 0.225]))
# Профиль хромы по ступеням: светлые тинты и тёмные тона держат насыщенность, а не выцветают в серый.
# Реальный предел задаёт гамут sRGB — oklch_to_hex сам срезает хрому там, где цвет невозможен.
CHROMA_PROFILE = dict(zip(STEPS, [0.38, 0.52, 0.72, 0.9, 1.0, 1.0, 1.0, 0.96, 0.88, 0.76, 0.62]))
DEFAULT_VIBRANCE = 1.2  # во сколько раз шкала сочнее исходного цвета (сам исходный цвет не меняется)
STATUS = {"positive": "#16a34a", "negative": "#dc2626"}
WHITE = "#ffffff"


# Имена оттенков по тону OKLCH (центр сектора, градусы). Палитра называет цвета как есть;
# смысл (accent, status, brand) появляется только в слое Brand.
HUE_NAMES = [(8, "rose"), (25, "red"), (42, "vermilion"), (58, "orange"), (75, "amber"), (95, "yellow"),
             (118, "lime"), (148, "green"), (168, "emerald"), (185, "teal"), (210, "cyan"), (232, "sky"),
             (255, "blue"), (272, "indigo"), (290, "violet"), (308, "purple"), (328, "magenta"), (348, "pink")]


def hue_name(hex_):
    L, C, H = hex_to_oklch(hex_)
    if C < 0.03:
        return "gray"
    name = min(HUE_NAMES, key=lambda x: min(abs(H - x[0]), 360 - abs(H - x[0])))[1]
    if L < 0.45 and name in ("rose", "red", "vermilion"):
        return "burgundy"
    if L < 0.5 and name in ("orange", "amber", "yellow"):
        return "brown"
    if L < 0.45 and name in ("purple", "magenta"):
        return "plum"
    return name


def nearest(L):
    return min(STEPS, key=lambda s: abs(LIGHTNESS[s] - L))


def ramp_from(hex_, vibrance=DEFAULT_VIBRANCE):
    L, C, H = hex_to_oklch(hex_)
    a = nearest(L)
    peak = max(C, 0.04) / CHROMA_PROFILE[a] * vibrance
    vals = {s: oklch_to_hex(LIGHTNESS[s], peak * CHROMA_PROFILE[s], H) for s in STEPS}
    vals[a] = hex_.lower()
    return vals, a


ROLE_DESC = {"accent-uno": "Основной акцент.", "accent-duo": "Второй акцент.", "brand-uno": "Основной фирменный.",
             "brand-duo": "Второй фирменный.", "positive": "Статус успеха.", "negative": "Статус ошибки."}


TONE_DESC = {"pale": "Самый светлый тон: тихие заливки", "soft": "Светлый тон: заметные заливки",
             "pure": "Чистый цвет бренда — ровно исходный цвет", "deep": "Тёмный тон: текст и иконки цвета"}


def pick_tones(a):
    """Четыре тона роли. Светлота тонов одинакова у всех брендов (pale 100, soft 300, deep 800),
    pure — ровно исходный цвет. Если исходный цвет сам светлый или тёмный, соседние тоны сдвигаются,
    чтобы порядок pale < soft < pure < deep сохранялся."""
    idx = STEPS.index
    pale, soft, deep = 100, 300, 800
    if a <= soft:
        soft = STEPS[max(idx(a) - 1, 0)]
        pale = STEPS[max(idx(soft) - 1, 0)]
    if a >= deep:
        deep = STEPS[min(idx(a) + 1, len(STEPS) - 1)]
    return {"pale": pale, "soft": soft, "pure": a, "deep": deep}


def tok(value, typ, desc):
    return {"$type": typ, "$value": value, "$description": desc}


def colors_of(spec):
    """Нормализует входной brand.json в набор исходных цветов по рампам."""
    def pair(v, fallback=None):
        if isinstance(v, str):
            return {"uno": v}
        return dict(v or fallback or {})
    accent = pair(spec["accent"])
    brand = pair(spec.get("brand"), accent)
    notes = []
    for name, d in (("accent", accent), ("brand", brand)):
        if "duo" not in d:
            L, C, H = hex_to_oklch(d["uno"])
            d["duo"] = oklch_to_hex(L, C, (H + 60) % 360)
            notes.append(f"{name}.duo не задан — взят {name}.uno со сдвигом тона +60°: {d['duo']}")
    src = {"accent-uno": accent["uno"], "accent-duo": accent["duo"],
           "brand-uno": brand["uno"], "brand-duo": brand["duo"]}
    st = spec.get("status", {})
    for k, v in STATUS.items():
        src[k] = st.get(k, v)
    return src, notes


NEUTRAL_EXTRA = {150: 0.915, 850: 0.345}  # промежуточные ступени для уровней ground


def build(spec):
    """Возвращает (палитра, бренд, отчёт, заметки).
    Палитра — сырые рампы, ничего не знает о бренде и теме.
    Бренд — верхний уровень: выбирает палитру и опорные цвета."""
    pid = spec.get("palette", spec["id"])
    src, notes = colors_of(spec)
    L, C, H = hex_to_oklch(src["accent-uno"])
    tint = spec.get("neutral", {}).get("tint", 0.012)
    nh = spec.get("neutral", {}).get("hue", H)
    nl = {**LIGHTNESS, **NEUTRAL_EXTRA}
    # нейтраль остаётся нейтралью: тонировка не растёт вместе с сочностью цветных шкал
    nprof = {**dict(zip(STEPS, [0.12, 0.22, 0.42, 0.66, 0.86, 1.0, 1.0, 0.92, 0.8, 0.66, 0.52])), 150: 0.3, 850: 0.72}
    nsteps = sorted(nl)
    neutral = {s: oklch_to_hex(nl[s], tint * nprof[s], nh) for s in nsteps}

    pal = {"$description": f"Палитра «{pid}». Сгенерировано tools/palette.py из brands/{spec['id']}.brand.json; руками не править."}
    pal["gray"] = {"$description": "Серая шкала: 13 ступеней (150 и 850 — промежуточные для земли)."}
    for s in nsteps:
        pal["gray"][str(s)] = tok(neutral[s], "color", f"gray {s}.")

    bcol = {"$description": f"Цвет бренда из палитры «{pid}»: нейтральная шкала и по четыре тона (pale, soft, pure, deep) на каждую роль."}
    P = lambda *p: "{palette." + ".".join(str(x) for x in p) + "}"
    bcol["white"] = tok(P("common", "white"), "color", "Белый.")
    bcol["black"] = tok(P("common", "black"), "color", "Чёрный.")
    bcol["neutral"] = {"$description": "Нейтральный цвет бренда. Шкала палитры: gray."}
    for s in nsteps:
        bcol["neutral"][str(s)] = tok(P(pid, "gray", s), "color", f"neutral {s} → gray {s}.")

    ink = neutral[950]
    best_on = lambda c: WHITE if contrast(WHITE, c) >= contrast(ink, c) else ink
    on_ref = lambda c: P("common", "white") if c == WHITE else P(pid, "gray", 950)
    report = {"gray": (neutral, None, None, nsteps)}
    names_override = spec.get("names", {})
    ramp_of_hex, used = {}, set()
    for name, hex_ in src.items():
        key = hex_.lower()
        if key not in ramp_of_hex:  # одинаковый цвет у разных ролей → одна шкала
            nm = names_override.get(name) or hue_name(hex_)
            base_nm, k = nm, 2
            while nm in used:
                nm, k = f"{base_nm}-{k}", k + 1
            used.add(nm)
            vals, a = ramp_from(hex_, spec.get("vibrance", DEFAULT_VIBRANCE))
            ramp_of_hex[key] = (nm, vals, a)
            pal[nm] = {"$description": f"{nm}: шкала из {hex_}."}
            for s_ in STEPS:
                pal[nm][str(s_)] = tok(vals[s_], "color", f"{nm} {s_}.")
            report[nm] = (vals, a, None, STEPS)
        nm, vals, a = ramp_of_hex[key]
        tones = pick_tones(a)
        report[nm] = (vals, a, None, STEPS)
        on = best_on(vals[a])
        g = {"$description": f"{ROLE_DESC[name]} Четыре тона из шкалы палитры {nm}: pale, soft, pure, deep."}
        for tone, step in tones.items():
            g[tone] = tok(P(pid, nm, step), "color", f"{TONE_DESC[tone]} ({nm} {step}).")
        g["on-pure"] = tok(on_ref(on), "color", f"Контент поверх pure, подобран по контрасту ({contrast(on, vals[a]):.2f}:1).")
        bcol[name] = g

    palette = {"palette": {pid: pal}}
    brand = {"brand": {"$description": f"Бренд «{spec['name']}» — верхний уровень. Сейчас: цвет. Дальше: типографика, скругления, размеры.",
                       "color": bcol}}
    return pid, palette, brand, report, notes


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    spec = json.loads(Path(args[0]).read_text())
    pid, palette, brand, report, notes = build(spec)
    for rel, data in ((f"tokens/palette/{pid}.json", palette), (f"tokens/brand/{spec['id']}.json", brand)):
        (ROOT / rel).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / rel).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print(f"✓ {rel}")

    cfg_path = ROOT / "kit.config.json"
    cfg = json.loads(cfg_path.read_text())
    if spec["id"] not in cfg["axes"]["brand"]["modes"]:
        cfg["axes"]["brand"]["modes"].append(spec["id"])
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")

    for n in notes:
        print("  · " + n)
    for name, (vals, a, d, steps) in report.items():
        cells = []
        for s in steps:
            l, r = ("[", "]") if s == a else (" ", " ")
            cells.append(f"{l}{vals[s]}{r}")
        print(f"  {name:11}" + "".join(cells))
    print("  [ ] — pure (исходный цвет)")
    if "--check" in sys.argv:
        sys.exit(subprocess.call([sys.executable, str(ROOT / "tools" / "build.py"), "--check"]))


if __name__ == "__main__":
    main()
