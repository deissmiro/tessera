#!/usr/bin/env python3
"""Разворачивает kb/color-model.json в tokens/theme.json и kb/contrast-pairs.json.
Вызывается из build.py автоматически; отдельно — python3 tools/theme_gen.py."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAMP = {("accent", "uno"): "accent-uno", ("accent", "duo"): "accent-duo",
        ("brand", "uno"): "brand-uno", ("brand", "duo"): "brand-duo",
        ("status", "positive"): "positive", ("status", "negative"): "negative"}


def ref(step, ramp=None):
    """Шаг модели → ссылка на токен бренда."""
    if step in ("white", "black"):
        return f"{{brand.color.{step}}}"
    if "." in step:  # neutral.100
        return f"{{brand.color.{step}}}"
    return f"{{brand.color.{ramp}.{step}}}"


def color(light, dark, desc, ramp=None):
    return {"$type": "color", "$modes": {"light": ref(light, ramp), "dark": ref(dark, ramp)}, "$description": desc}


def generate():
    m = json.loads((ROOT / "kb/color-model.json").read_text())
    groups, meanings, steps = m["groups"], m["meanings"], m["steps"]
    root = {"$description": "Семантика цвета. Сгенерировано tools/theme_gen.py из kb/color-model.json — руками не править."}
    figma_names = set()

    for g, gdef in sorted(groups.items(), key=lambda x: x[1]["order"]):
        node = root.setdefault(g, {"$description": gdef["description"]})
        short = gdef["description"].split(":")[0].split(".")[0]
        if gdef["shape"] == "levels":
            for lvl in gdef["levels"]:
                light, dark = gdef["steps"][lvl]
                node[lvl] = color(light, dark, f"{short} · {lvl}.")
                figma_names.add(f"{g}/{lvl}")
            continue
        for mean in m["availability"][g]:
            mdef = meanings[mean]
            for scheme in mdef["schemes"]:
                name = mean if scheme is None else f"{mean}-{scheme}"
                kind = mdef["kind"]
                ramp, swap = None, kind == "inverse"
                if kind == "static" and g in mdef.get("single", {}):
                    light, dark = mdef["single"][g][scheme]
                    node[name] = color(light, dark, f"{short} · {name}. {mdef['description'].split('.')[0]}.")
                    figma_names.add(f"{g}/{name}")
                    continue
                if kind == "inverse" and g in mdef.get("single", {}):
                    light, dark = mdef["single"][g]
                    node[name] = color(light, dark, f"{short} · {name}. {mdef['description'].split('.')[0]}.")
                    figma_names.add(f"{g}/{name}")
                    continue
                if kind in ("neutral", "inverse"):
                    table = steps["neutral"].get(g)
                elif kind == "colored":
                    table, ramp = steps["colored"].get(g), RAMP[(mean, scheme)]
                else:
                    table = steps["static"][scheme].get(g)
                if not table:
                    continue
                for lvl in gdef["levels"]:
                    if lvl not in table or lvl in mdef.get("exclude", {}).get(g, []):
                        continue
                    light, dark = table[lvl]
                    if swap:
                        light, dark = dark, light
                    desc = f"{short} · {name} · {lvl}. {mdef['description'].split('.')[0]}."
                    if gdef["shape"] == "flat":
                        node[f"{name}-{lvl}"] = color(light, dark, desc, ramp)
                        figma_names.add(f"{g}/{name}-{lvl}")
                    else:
                        node.setdefault(name, {"$description": mdef["description"]})[lvl] = color(light, dark, desc, ramp)
                        figma_names.add(f"{g}/{name}/{lvl}")

    colored = sorted({n.split("/")[1].rsplit("-", 1)[0] for n in figma_names
                      if n.startswith("background/") and n.split("/")[1].startswith(("accent", "status", "brand"))})
    levels = [l for l in groups["ground"]["levels"] if l != "scrim"]
    pairs = []
    for r in m["pairs"]["rules"]:
        both = r["fg"] + r["bg"]
        for c in (colored if "{m}" in both else [None]):
            for gl in (levels if "{g}" in both else [None]):
                fg, bg = (s.replace("{m}", c or "").replace("{g}", gl or "") for s in (r["fg"], r["bg"]))
                if fg in figma_names and bg in figma_names:
                    pairs.append({"fg": "theme." + fg.replace("/", "."), "bg": "theme." + bg.replace("/", "."),
                                  "min": r["min"], **({"severity": r["severity"]} if "severity" in r else {})})

    (ROOT / "tokens/theme.json").write_text(json.dumps({"theme": root}, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "kb/contrast-pairs.json").write_text(json.dumps(
        {"$description": "Сгенерировано из kb/color-model.json → pairs. Правьте правила там.", "pairs": pairs},
        ensure_ascii=False, indent=2) + "\n")
    return len(figma_names), len(pairs)


if __name__ == "__main__":
    n, p = generate()
    print(f"✓ tokens/theme.json: {n} цветов, пар контраста: {p}")
