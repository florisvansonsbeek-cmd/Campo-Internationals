"""Tulp: one red tulip up close against a soft-focus field, as a macro photograph would show it. One of the
pictures that take turns in the arch of the front-page hero, in the style of the seedling (kiem.py).

Every petal and leaf is a shape drawn from signed distances, so edges stay clean: petals are egg-shaped
and cupped, lit from the upper left, with fine lengthwise veins and a satin sheen; the stem is a lit
cylinder. The field behind is blurred tulips and greenery.

    python3 scripts/art/tulp.py  ->  public/img/tulp-{w}.{avif,webp}  (portrait, 11:14)
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

import kiem

W, H = 1100, 1400
kiem.W, kiem.H = W, H
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
F = np.float32
lerp, sstep, noise, paste = kiem.lerp, kiem.sstep, kiem.noise, kiem.paste


def shape(base, tip, half, kind, bend=0.0, colours=None, light_side=-1, seed=0):
    """a petal or leaf from `base` to `tip`, as an RGBA layer with its top-left corner"""
    base, tip = np.array(base, F), np.array(tip, F)
    ln = float(np.linalg.norm(tip - base))
    d = (tip - base) / ln
    p = np.array([-d[1], d[0]], F)  # to the right of the direction of growth
    pad = half * 1.3 + abs(bend) * ln + 12
    lo = np.floor(np.minimum(base, tip) - pad).astype(int)
    hi = np.ceil(np.maximum(base, tip) + pad).astype(int)
    gy, gx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]].astype(F)
    rx, ry = gx - base[0], gy - base[1]
    a = (rx * d[0] + ry * d[1]) / ln
    b = rx * p[0] + ry * p[1]
    ap = np.clip(a, 0, 1)
    if kind == 'petal':
        v = b - bend * ln * np.sin(ap * math.pi)  # a petal bulges out in the middle and closes in at the top
        w = half * np.clip(np.sin(ap * math.pi), 0, 1) ** 0.42 * (0.86 + 0.14 * ap)
    else:  # a long tulip leaf
        v = b - bend * ln * np.sin(ap * math.pi * 0.5) ** 2
        w = half * (ap ** 0.35) * (1 - ap) ** 0.75 / 0.62
    w = np.where((a < 0) | (a > 1), -1, w)
    dw = np.gradient(w, axis=1) ** 2 + np.gradient(w, axis=0) ** 2
    alpha = np.clip((w - np.abs(v)) / np.sqrt(1 + dw) + 0.5, 0, 1)
    t = np.clip(v / np.maximum(w, 1e-3), -1, 1)  # -1 left edge, +1 right edge
    # a cupped surface: lit in the middle and on the side towards the light, darker where it turns away
    face = np.sqrt(np.clip(1 - t * t, 0, 1))
    lit = np.clip(0.55 * face + 0.45 * np.clip(-t * light_side, 0, 1) * face + 0.25, 0, 1.2)
    deep, mid, light, edge = (np.array(c, F) for c in colours)
    col = lerp(deep, mid, sstep(0.0, 0.75, lit)[..., None])
    col = lerp(col, light, (sstep(0.75, 1.15, lit) * 0.9)[..., None])
    if kind == 'petal':
        veins = 0.5 + 0.5 * np.sin(t * 34 + np.sin(ap * 7 + seed) * 1.4 + ndimage.gaussian_filter(np.random.default_rng(seed + 50).standard_normal(alpha.shape).astype(F), 6) * 3)
        col *= (0.965 + 0.045 * veins * sstep(0.1, 0.5, ap))[..., None]
        sheen = np.exp(-((t + 0.22 * light_side) / 0.2) ** 2) * sstep(0.2, 0.6, ap) * (1 - sstep(0.85, 1.0, ap))
        col = lerp(col, np.array([252, 170, 150], F), (sheen * 0.28)[..., None])
        base_tint = 1 - sstep(0.0, 0.22, ap)
        col = lerp(col, np.array([226, 150, 60], F), (base_tint * 0.35)[..., None])
    else:
        mid_line = np.exp(-(t / 0.05) ** 2) * (ap > 0.02)
        col = lerp(col, light, (mid_line * 0.25)[..., None])
    rim = np.exp(-np.clip(w - np.abs(v), 0, None) / 2.2)
    col = lerp(col, edge, (rim * 0.55 * (a > 0.03))[..., None])
    col *= (1 + 0.03 * ndimage.gaussian_filter(np.random.default_rng(seed).standard_normal(alpha.shape).astype(F), 1.0))[..., None]
    return lo, np.dstack([np.clip(col, 0, 255), alpha])


def blurred(layer, sigma):
    if sigma <= 0.3:
        return layer
    rgb, a = layer[..., :3] * layer[..., 3:4], layer[..., 3]
    rgb = np.dstack([ndimage.gaussian_filter(rgb[..., c], sigma) for c in range(3)])
    a = ndimage.gaussian_filter(a, sigma)
    return np.dstack([rgb / np.maximum(a, 1e-4)[..., None], a])


def tulip(cx, cy, s, red=True, seed=0):
    """the layers of one tulip head (back to front), centred on (cx, cy), size factor s: an egg-shaped cup"""
    if red:
        cols = ([108, 6, 22], [196, 24, 38], [242, 88, 76], [255, 136, 116])
    else:
        cols = ([196, 120, 10], [242, 186, 30], [255, 226, 110], [255, 240, 170])
    layers = []
    # the two inner petals behind, only their tops show between the outer ones
    layers.append(shape((cx - 6 * s, cy + 170 * s), (cx - 40 * s, cy - 222 * s), 96 * s, 'petal', -0.06, cols, -1, seed + 1))
    layers.append(shape((cx + 6 * s, cy + 170 * s), (cx + 46 * s, cy - 224 * s), 96 * s, 'petal', 0.06, cols, -1, seed + 2))
    # the outer petals: left and right bulge out, the front one closes the cup
    layers.append(shape((cx - 14 * s, cy + 206 * s), (cx - 52 * s, cy - 200 * s), 104 * s, 'petal', -0.075, cols, -1, seed + 3))
    layers.append(shape((cx + 14 * s, cy + 206 * s), (cx + 58 * s, cy - 202 * s), 104 * s, 'petal', 0.075, cols, -1, seed + 4))
    layers.append(shape((cx, cy + 214 * s), (cx + 6 * s, cy - 196 * s), 122 * s, 'petal', 0.0, cols, -1, seed + 5))
    return layers


def main():
    r = np.random.default_rng(1637)
    bg = kiem.background(r)
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    bg = lerp(bg, np.array([150, 176, 96], F), (0.18 * sstep(0.0, 1.0, yy / H))[..., None])
    # far tulips: soft colour in the lower part of the field
    far = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(far)
    for _ in range(120):
        x, y = r.uniform(-0.05, 1.05) * W, r.uniform(0.5, 1.05) * H
        rad = r.uniform(18, 60) * (0.5 + 0.8 * (y / H - 0.5))
        c = [(214, 40, 52), (232, 70, 80), (240, 188, 52), (226, 98, 150)][r.integers(4)]
        d.ellipse([x - rad * 0.8, y - rad, x + rad * 0.8, y + rad], fill=c + (int(r.uniform(90, 170)),))
    far = far.filter(ImageFilter.GaussianBlur(26))
    fa = np.asarray(far, dtype=F)
    bg = lerp(bg, fa[..., :3], (fa[..., 3:4] / 255) * 0.85)

    img = bg.copy()
    # a second tulip, further back and out of focus
    for lo, ly in tulip(868, 500, 0.6, red=False, seed=40):
        paste(img, None, lo, blurred(ly, 13))
    # leaves rising from the bottom, blue-green and a little soft
    leaf_cols = ([46, 84, 64], [92, 138, 104], [150, 186, 150], [186, 210, 180])
    for base, tip_, half, bend, side, sg in (((330, 1520), (60, 760), 120, -0.1, -1, 12), ((790, 1540), (1010, 930), 110, 0.08, -1, 14)):
        lo, ly = shape(base, tip_, half, 'leaf', bend, leaf_cols, side, 7)
        paste(img, None, lo, blurred(ly, sg))
    # the stem, then the head
    lo, st, _top = kiem.stem_layer([(574, 1460), (540, 1240), (570, 1030), (552, 790)], 24, 19)
    st[..., :3] = lerp(st[..., :3], np.array([92, 136, 70], F), 0.35)
    paste(img, None, lo, st)
    for lo, ly in tulip(552, 600, 1.12, red=True, seed=10):
        paste(img, None, lo, ly)

    vig = 1 - 0.26 * (((xx / W - 0.5) / 0.75) ** 2 + ((yy / H - 0.45) / 0.8) ** 2)
    img *= np.clip(vig, 0.6, 1)[..., None]
    img = img * 0.95 + 8
    img[..., 0] *= 1.02
    img[..., 2] *= 0.95
    img += np.random.default_rng(4).normal(0, 3.0, (H, W)).astype(F)[..., None]
    final = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    final.save('/tmp/tulp-full.png')
    final.resize((550, 700), Image.LANCZOS).save('/tmp/tulp-preview.png')
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (480, 760, 1100):
        im = final if w == W else final.resize((w, round(H * w / W)), Image.LANCZOS)
        im.save(OUT / f'tulp-{w}.webp', quality=82, method=6)
        im.save(OUT / f'tulp-{w}.avif', quality=60)
    print('tulp done')


if __name__ == '__main__':
    main()
