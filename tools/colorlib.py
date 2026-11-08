"""Цветовая математика без зависимостей: sRGB ⇄ OKLab/OKLCH, гамут-маппинг, контраст WCAG 2."""
import math


def hex_to_rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) not in (6, 8):
        raise ValueError(f"bad hex: {h}")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def rgb_to_hex(r, g, b, a=1.0):
    c = lambda v: max(0, min(255, round(v * 255)))
    s = f"#{c(r):02x}{c(g):02x}{c(b):02x}"
    return s + (f"{c(a):02x}" if a < 0.999 else "")


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def rgb_to_oklab(r, g, b):
    r, g, b = _lin(r), _lin(g), _lin(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_linear_rgb(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def hex_to_oklch(h):
    r, g, b, _ = hex_to_rgb(h)
    L, a, bb = rgb_to_oklab(r, g, b)
    C = math.hypot(a, bb)
    H = math.degrees(math.atan2(bb, a)) % 360
    return L, C, H


def _in_gamut(rgb, eps=1e-6):
    return all(-eps <= v <= 1 + eps for v in rgb)


def oklch_to_hex(L, C, H):
    """OKLCH → hex с гамут-маппингом: снижаем хрому при неизменных L и H."""
    hr = math.radians(H)
    lo, hi = 0.0, C
    rgb = oklab_to_linear_rgb(L, C * math.cos(hr), C * math.sin(hr))
    if not _in_gamut(rgb):
        for _ in range(30):
            mid = (lo + hi) / 2
            rgb_mid = oklab_to_linear_rgb(L, mid * math.cos(hr), mid * math.sin(hr))
            if _in_gamut(rgb_mid):
                lo = mid
            else:
                hi = mid
        rgb = oklab_to_linear_rgb(L, lo * math.cos(hr), lo * math.sin(hr))
    r, g, b = (_gam(max(0.0, min(1.0, v))) for v in rgb)
    return rgb_to_hex(r, g, b)


def relative_luminance(h):
    r, g, b, _ = hex_to_rgb(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def blend(fg, bg):
    """Накладывает полупрозрачный fg на непрозрачный bg."""
    r1, g1, b1, a = hex_to_rgb(fg)
    r2, g2, b2, _ = hex_to_rgb(bg)
    return rgb_to_hex(r1 * a + r2 * (1 - a), g1 * a + g2 * (1 - a), b1 * a + b2 * (1 - a))


def contrast(fg, bg):
    if hex_to_rgb(fg)[3] < 1:
        fg = blend(fg, bg)
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
