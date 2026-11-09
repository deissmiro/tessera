#!/usr/bin/env python3
"""Сборка и проверка цвета.

    python3 tools/build.py            # проверка + сборка dist/
    python3 tools/build.py --check    # только проверка

Перед проверкой разворачивает kb/color-model.json в tokens/theme.json.
Проверяет: направление ссылок между слоями (kit.config.json → references),
описание у каждого токена, полноту модов, циклы, контраст пар во всех brand × theme.
Собирает:
  dist/figma/variables.json — коллекции, моды, переменные с алиасами (для плагина figma-sync), включая Numbers
  dist/css/tokens.css       — CSS-переменные с той же слоистостью (data-brand / data-theme)
  dist/tokens.flat.json     — плоский индекс для MCP-сервера
"""
import itertools
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from colorlib import contrast  # noqa: E402
from theme_gen import generate as generate_theme  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REF = re.compile(r"^\{([a-z0-9.\-]+)\}$")
MUST_REFERENCE = {"brand", "theme", "preset"}
errors, warnings = [], []


def load(p):
    return json.loads(Path(p).read_text())


def walk(node, path, out):
    for k, v in node.items():
        if k.startswith("$") or not isinstance(v, dict):
            continue
        p = f"{path}.{k}"
        if "$type" in v:
            out.append((p, v))
        else:
            walk(v, p, out)


def collect(cfg):
    tokens = {}
    for layer in cfg["layers"]:
        lid, axis = layer["id"], layer["axis"]
        per_mode = "{mode}" in layer["files"]
        sources = ([(m, ROOT / layer["files"].replace("{mode}", m)) for m in cfg["axes"][axis]["modes"]]
                   if per_mode else [(None, f) for f in sorted(ROOT.glob(layer["files"]))])
        for mode, f in sources:
            if not f.exists():
                errors.append(f"{lid}: мод «{mode}» объявлен, но нет {f.relative_to(ROOT)} — запустите tools/palette.py")
                continue
            found = []
            walk(load(f)[lid], lid, found)
            for path, n in found:
                t = tokens.setdefault(path, {"path": path, "layer": lid, "type": n["$type"], "description": n.get("$description", ""),
                                             "values": {}, "src": str(f.relative_to(ROOT)), "ext": n.get("$extensions", {})})
                if per_mode:
                    t["values"][mode] = n.get("$value")
                elif "$modes" in n:
                    t["values"] = dict(n["$modes"])
                else:
                    t["values"] = {"_": n.get("$value")}
    return tokens


def axis_of(cfg, layer):
    return next(l["axis"] for l in cfg["layers"] if l["id"] == layer)


def validate(cfg, tokens):
    allowed = cfg["references"]
    for t in tokens.values():
        if not t["description"].strip():
            errors.append(f"{t['path']}: нет $description — документация живёт в описаниях")
        axis = axis_of(cfg, t["layer"])
        expected = set(cfg["axes"][axis]["modes"]) if axis else {"_"}
        if set(t["values"]) != expected:
            errors.append(f"{t['path']}: моды {sorted(t['values'])} ≠ {sorted(expected)} ({t['src']})")
        for mode, v in t["values"].items():
            m = REF.match(v) if isinstance(v, str) else None
            if m:
                target = m.group(1)
                if target not in tokens:
                    errors.append(f"{t['path']} [{mode}]: ссылка на несуществующий {target}")
                    continue
                tl = tokens[target]["layer"]
                if tl != t["layer"] and tl not in allowed[t["layer"]]:
                    errors.append(f"{t['path']}: слой {t['layer']} не может ссылаться на {tl} ({target})")
            elif t["layer"] in MUST_REFERENCE:
                errors.append(f"{t['path']} [{mode}]: в слое {t['layer']} допускаются только ссылки, найдено «{v}»")


def resolve(tokens, cfg, path, ctx, seen=()):
    if path in seen:
        raise RecursionError(" → ".join(seen + (path,)))
    t = tokens[path]
    axis = axis_of(cfg, t["layer"])
    v = t["values"].get(ctx[axis] if axis else "_")
    m = REF.match(v) if isinstance(v, str) else None
    return resolve(tokens, cfg, m.group(1), ctx, seen + (path,)) if m else v


def contexts(cfg):
    keys = list(cfg["axes"])
    for combo in itertools.product(*(cfg["axes"][k]["modes"] for k in keys)):
        yield dict(zip(keys, combo))


def check_contrast(cfg, tokens):
    pairs = load(ROOT / cfg["contrast"]["pairs"])["pairs"]
    report = []
    for ctx in contexts(cfg):
        if any(ctx[a] != cfg["axes"][a]["default"] for a in cfg["axes"] if a not in ("brand", "theme")):
            continue
        for p in pairs:
            fg, bg = resolve(tokens, cfg, p["fg"], ctx), resolve(tokens, cfg, p["bg"], ctx)
            r = contrast(fg, bg)
            ok = r + 1e-9 >= p["min"]
            report.append((ctx["brand"], ctx["theme"], p["fg"], p["bg"], round(r, 2), p["min"], ok))
            if not ok:
                (warnings if p.get("severity") == "warn" else errors).append(
                    f"контраст {ctx['brand']}/{ctx['theme']}: {p['fg']} на {p['bg']} = {r:.2f}:1 < {p['min']}:1")
    return report


# ---------- Figma

def figma_name(path):
    return "/".join(path.split(".")[1:])


SCOPES = [(r"^theme\.border", ["STROKE_COLOR"]),
          (r"^theme\.content", ["TEXT_FILL", "SHAPE_FILL"]),
          (r"^theme\.ground", ["FRAME_FILL"]),
          (r"^theme\.background", ["FRAME_FILL", "SHAPE_FILL"]),
          (r"^numbers\.opacity", ["OPACITY"]),
          (r"^preset\..*border", ["STROKE_COLOR"]),
          (r"^preset\.", ["FRAME_FILL", "SHAPE_FILL"]),
          (r"line-height", ["LINE_HEIGHT"]),
          (r"(font-size|label-size|value-size|hint-size|title-size|subtitle-size)", ["FONT_SIZE"]),
          (r"^viewport\.(spinner\.[sml]$|badge\.dot|pagination\.dot|stepper\..*button|tabbar\.icon|datepicker\.day$|code\.cell)", ["WIDTH_HEIGHT"]),
          (r"(divider\.(line|section)|progress\.height|overlay\.arrow|active-width|value-width)", ["WIDTH_HEIGHT"]),
          (r"spinner\.stroke", ["STROKE_FLOAT"]),
          (r"focus-ring", ["STROKE_FLOAT"]),
          (r"radius", ["CORNER_RADIUS"]),
          (r"(\.size|\.icon|\.knob|min-height|pill-height)$", ["WIDTH_HEIGHT"]),
          (r"underline$", ["WIDTH_HEIGHT"]),
          (r"\.inset$", ["GAP"]),
          (r"title-size", ["FONT_SIZE"]),
          (r"(padding|margin|gap)", ["GAP"]),
          (r"(width|height)", ["WIDTH_HEIGHT"])]


def scopes_for(t):
    if "scopes" in t["ext"].get("figma", {}):
        return t["ext"]["figma"]["scopes"]
    for rx, sc in SCOPES:
        if re.search(rx, t["path"]):
            return sc
    return []  # палитра и бренд скрыты из пикеров


def figma_value(tokens, cfg, v):
    m = REF.match(v) if isinstance(v, str) else None
    if m:
        target = tokens[m.group(1)]
        coll = next(l["collection"] for l in cfg["layers"] if l["id"] == target["layer"])
        return {"$alias": f"{coll}::{figma_name(target['path'])}"}
    return v


def build_figma(cfg, tokens):
    out = {"kit": cfg["name"], "version": cfg["version"], "collections": []}
    for layer in cfg["layers"]:
        axis = layer["axis"]
        modes = cfg["axes"][axis]["modes"] if axis else ["default"]
        vars_ = [{
            "name": figma_name(t["path"]),
            "type": {"color": "COLOR", "boolean": "BOOLEAN"}.get(t["type"], "FLOAT"),
            "description": t["description"],
            "scopes": scopes_for(t),
            "hiddenFromPublishing": layer["id"] in ("palette", "brand"),
            "codeSyntax": {"WEB": f"var(--{t['path'].replace('.', '-')})"},
            "valuesByMode": {m: figma_value(tokens, cfg, t["values"].get(m if axis else "_")) for m in modes},
        } for t in tokens.values() if t["layer"] == layer["id"]]
        out["collections"].append({"name": layer["collection"], "description": layer["description"], "modes": modes, "variables": vars_})
    return out


def build_css(cfg, tokens):
    blocks = {}
    for t in tokens.values():
        axis = axis_of(cfg, t["layer"])
        for mode, v in t["values"].items():
            if not axis:
                sel = ":root"
            elif "breakpoints" in cfg["axes"][axis]:
                px = cfg["axes"][axis]["breakpoints"][mode]
                sel = ":root" if not px else f"@media (min-width: {px}px)"
            else:
                attr = f'[data-{axis}="{mode}"]'
                sel = f":root, {attr}" if mode == cfg["axes"][axis]["default"] else attr
            m = REF.match(v) if isinstance(v, str) else None
            if m:
                val = f"var(--{m.group(1).replace('.', '-')})"
            elif "opacity" in t["path"]:
                val = round(v / 100, 2)
            elif isinstance(v, bool):
                val = int(v)
            elif isinstance(v, (int, float)):
                val = f"{v}px"
            else:
                val = v
            blocks.setdefault(sel, []).append(f"  --{t['path'].replace('.', '-')}: {val};")
    head = f"/* {cfg['name']} {cfg['version']} — сгенерировано tools/build.py, не править */"
    out = []
    for s, d in blocks.items():
        if s.startswith("@media"):
            out.append(f"{s} {{\n  :root {{\n" + "\n".join("  " + x for x in d) + "\n  }\n}")
        else:
            out.append(f"{s} {{\n" + "\n".join(d) + "\n}")
    return head + "\n\n" + "\n\n".join(out) + "\n"


def main():
    check_only = "--check" in sys.argv
    generate_theme()
    cfg = load(ROOT / "kit.config.json")
    tokens = collect(cfg)
    validate(cfg, tokens)
    report = []
    if not errors and cfg["axes"]["brand"]["modes"]:
        try:
            report = check_contrast(cfg, tokens)
        except RecursionError as e:
            errors.append(f"цикл ссылок: {e}")

    counts = {}
    for t in tokens.values():
        counts[t["layer"]] = counts.get(t["layer"], 0) + 1
    print(f"{cfg['name']} {cfg['version']}: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    print("оси: " + " × ".join(f"{k}({len(a['modes'])})" for k, a in cfg["axes"].items()))
    if report:
        print(f"контраст: {sum(r[-1] for r in report)}/{len(report)} пар в порядке")
    for w in warnings:
        print("  ⚠ " + w)
    if errors:
        print(f"\n✗ ошибок: {len(errors)}")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("✓ архитектура и контраст в порядке")
    if check_only:
        return

    dist = ROOT / "dist"
    (dist / "figma").mkdir(parents=True, exist_ok=True)
    (dist / "css").mkdir(parents=True, exist_ok=True)
    (dist / "figma/variables.json").write_text(json.dumps(build_figma(cfg, tokens), ensure_ascii=False, indent=1))
    (dist / "css/tokens.css").write_text(build_css(cfg, tokens))
    flat = {"kit": cfg["name"], "version": cfg["version"], "axes": cfg["axes"], "layers": cfg["layers"],
            "tokens": [{k: t[k] for k in ("path", "layer", "type", "description", "values", "src")} for t in tokens.values()],
            "contrast": [dict(zip(("brand", "theme", "fg", "bg", "ratio", "min", "ok"), r)) for r in report]}
    (dist / "tokens.flat.json").write_text(json.dumps(flat, ensure_ascii=False))
    print("✓ dist/figma/variables.json, dist/css/tokens.css, dist/tokens.flat.json")


if __name__ == "__main__":
    main()
