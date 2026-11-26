"""Dauw: morning dew on a leaf, as a macro photograph would show it. One of the pictures that take turns
in the arch of the front-page hero, in the same style as the seedling (scripts/art/kiem.py).

A large leaf crosses the frame against soft-focus greenery. Its surface is lit through a height field:
the fold along the midrib, sunken veins and a fine network of cells. Water drops sit on it and work as
small lenses: they magnify the leaf beneath, darken at the rim towards the light, gather a bright
caustic on the far side and catch the sun in a highlight. One drop hangs from the tip and shows the
scene behind it upside down.

    python3 scripts/art/dauw.py  ->  public/img/dauw-{w}.{avif,webp}  (portrait, 11:14)
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

import kiem

W, H = 1100, 1400
kiem.W, kiem.H = W, H
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
F = np.float32
lerp, sstep, noise = kiem.lerp, kiem.sstep, kiem.noise


def leaf(base, theta, ln, half, droop):
    """the leaf as RGBA over the whole frame, plus its length coordinate (for the depth of field)"""
    th = math.radians(theta)
    d = np.array([math.cos(th), -math.sin(th)], F)
    p = np.array([math.sin(th), math.cos(th)], F)
    gy, gx = np.mgrid[0:H, 0:W].astype(F)
    rx, ry = gx - base[0], gy - base[1]
    a = (rx * d[0] + ry * d[1]) / ln
    b = rx * p[0] + ry * p[1]
    bend = droop * math.cos(th) * ln
    v = b - bend * np.clip(a, 0, 1) ** 2
    ap = np.clip(a, 0, 1)
    pq, qq = 0.78, 0.9
    peak = (pq / (pq + qq)) ** pq * (qq / (pq + qq)) ** qq
    w = half * ap ** pq * (1 - ap) ** qq / peak
    w = np.where((a < 0) | (a > 1), -1, w)
    dw = np.gradient(w, axis=1) ** 2 + np.gradient(w, axis=0) ** 2
    alpha = np.clip((w - np.abs(v)) / np.sqrt(1 + dw) + 0.5, 0, 1)
    t = np.clip(np.abs(v) / np.maximum(w, 1e-3), 0, 1)
    side = np.sign(v)

    # height: the two halves rise from the midrib and roll down at the edge; veins and cells are sunk in
    hgt = 0.05 * half * (np.sin(np.clip(t, 0, 1) * math.pi * 0.85)) - 0.012 * half * np.exp(-(v / (0.02 * half)) ** 2)
    n_vein = 13
    vs = (ap - 0.34 * t ** 1.1) * n_vein
    dv = np.abs(vs - np.round(vs)) / n_vein * ln  # distance to the nearest secondary vein, in pixels
    vein = np.exp(-(dv / 3.2) ** 2) * sstep(0.04, 0.12, t) * (1 - sstep(0.86, 0.98, t))
    hgt -= vein * 2.2
    cells_pts = np.column_stack([np.random.default_rng(8).uniform(0, W, 9000), np.random.default_rng(9).uniform(0, H, 9000)]).astype(F)
    dd, _ = cKDTree(cells_pts).query(np.column_stack([gx.ravel(), gy.ravel()]), k=2, workers=-1)
    cell_edge = np.exp(-((dd[:, 1] - dd[:, 0]).reshape(H, W) / 1.6) ** 2)
    hgt -= cell_edge * 0.7
    hgt += noise(H, W, 1.2, 31) * 0.25
    gyy, gxx = np.gradient(ndimage.gaussian_filter(hgt, 0.8))
    nrm = np.stack([-gxx, -gyy, np.ones_like(gxx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    lv = np.array([-0.55, -0.6, 0.58], F)
    lv /= np.linalg.norm(lv)
    diff = np.clip(nrm @ lv, 0, 1)
    hv = lv + np.array([0, 0, 1], F)
    hv /= np.linalg.norm(hv)
    spec = np.clip(nrm @ hv, 0, 1) ** 60 * 0.5

    # colour: light comes through the leaf, yellower at the edge and towards the tip, deeper along the midrib
    deep, mid, light, rim = (np.array(c, F) for c in ([46, 94, 34], [88, 146, 50], [156, 196, 78], [206, 226, 126]))
    col = lerp(mid, light, (t ** 1.4 * 0.8)[..., None])
    col = lerp(col, deep, ((1 - sstep(0.0, 0.25, ap)) * 0.5)[..., None])
    col = lerp(col, light, (sstep(0.6, 1.0, ap) * 0.3)[..., None])
    col *= (0.9 + 0.12 * (side > 0))[..., None]
    col = lerp(col, rim, (np.exp(-np.clip(w - np.abs(v), 0, None) / 3.5) * 0.5 * (a > 0.02))[..., None])
    midrib = np.exp(-(v / (0.012 * half + 1.5)) ** 2) * (ap > 0.01) * (1 - sstep(0.85, 0.99, ap))
    col = lerp(col, np.array([198, 220, 140], F), (midrib * 0.55)[..., None])
    col = lerp(col, light * 1.08, (vein * 0.35)[..., None])
    col *= (0.72 + 0.48 * diff)[..., None]
    col += spec[..., None] * np.array([240, 246, 220], F)
    col *= (1 + 0.05 * noise(H, W, 1.0, 33))[..., None]
    return np.clip(col, 0, 255), alpha, ap, (d, p)


def bilinear(img, sx, sy):
    sx = np.clip(sx, 0, W - 1.001)
    sy = np.clip(sy, 0, H - 1.001)
    x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def drop(img, cx, cy, r, hanging=False, tip=None):
    """a water drop as a lens: magnifies what lies beneath (or, hanging, flips the scene behind)"""
    pad = int(r * 1.6) + 4
    x0, x1, y0, y1 = max(0, int(cx - pad)), min(W, int(cx + pad)), max(0, int(cy - pad - (r * 1.4 if hanging else 0))), min(H, int(cy + pad))
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(F)
    dx, dy = (gx - cx) / r, (gy - cy) / r
    d = np.sqrt(dx * dx + dy * dy)
    if hanging:
        # a teardrop: round below, narrowing above up to the tip of the leaf
        ty = (tip[1] - cy) / r
        sv = np.clip(dy / ty, 0, None)
        hw = np.clip(1 - sv, 0, 1) ** 0.7
        d = np.where(dy < 0, np.where(sv < 1, np.abs(dx) / np.maximum(hw, 1e-3), 9), d)
    alpha = np.clip((1 - d) * r + 0.5, 0, 1)
    ux, uy = dx / np.maximum(d, 1e-3), dy / np.maximum(d, 1e-3)
    toward = np.clip(-(ux * 0.7 + uy * 0.7), -1, 1)  # +1 on the side the light comes from (upper left)
    if hanging:
        k = -1.7
        src = bilinear(img, cx + dx * r * k, cy - 0.6 * r + dy * r * k)
        src = lerp(src, np.array([210, 226, 200], F), 0.15)
    else:
        k = 0.66 + 0.34 * np.clip(d, 0, 1) ** 4
        src = bilinear(img, cx + dx * r * k, cy + dy * r * k)
    col = src * (1.06 + 0.1 * (1 - np.clip(d, 0, 1) ** 2))[..., None]
    rimdark = sstep(0.62, 1.0, d) * (0.22 + 0.5 * np.clip(toward, 0, 1))
    col *= (1 - rimdark)[..., None]
    caustic = np.exp(-((d - 0.62) / 0.22) ** 2) * np.clip(-toward, 0, 1) ** 2 * 0.55
    col = lerp(col, np.array([246, 250, 214], F), np.clip(caustic, 0, 1)[..., None])
    hx, hy = (dx + 0.36) / 0.2, (dy + 0.42) / 0.13
    hl = np.clip(1.3 - np.sqrt(hx * hx + hy * hy), 0, 1) ** 1.5
    h2 = np.clip(1.2 - np.sqrt(((dx - 0.3) / 0.08) ** 2 + ((dy - 0.36) / 0.05) ** 2), 0, 1) * 0.5
    col = lerp(col, np.array([255, 255, 250], F), np.clip(hl + h2, 0, 1)[..., None])
    # the drop's shade on the leaf, away from the light, just outside its rim
    sub = img[y0:y1, x0:x1]
    if not hanging:
        sh = np.exp(-((d - 1.0) / 0.16) ** 2) * np.clip(-toward, 0, 1) * (d > 1) * 0.35
        sub *= (1 - sh)[..., None]
    img[y0:y1, x0:x1] = lerp(sub, col, alpha[..., None])


def main():
    r = np.random.default_rng(611)
    bg = kiem.background(r)
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    # a fresher, lighter morning than the seedling's
    bg = lerp(bg, np.array([196, 214, 140], F), (0.16 * sstep(0.3, 1.0, 1 - yy / H))[..., None])
    base = np.array([-80, 1500], F)
    col, al, ap, (dv, pv) = leaf(base, 53, 1560, 370, 0.09)
    img = lerp(bg, col, al[..., None])
    focus_a = 0.5
    sig = np.where(al > 0.02, 0.4 + 10 * np.clip(np.abs(ap - focus_a) / 0.5, 0, 1) ** 1.6, 0).astype(F)
    sig = ndimage.gaussian_filter(sig, 6)
    img = kiem.depth_of_field(img, sig, 0)

    bend = 0.09 * math.cos(math.radians(53)) * 1560

    def on_leaf(a, s):
        pt = base + dv * a * 1560 + pv * (bend * a * a + s * 370 * (1 - abs(a - 0.5) * 1.4))
        return float(pt[0]), float(pt[1])

    drops = [(0.5, -0.12, 64), (0.58, 0.32, 36), (0.43, 0.42, 26), (0.66, -0.36, 30), (0.36, -0.3, 18), (0.53, 0.12, 12),
             (0.47, 0.6, 14), (0.62, 0.05, 10), (0.72, 0.2, 16), (0.4, 0.05, 9), (0.57, -0.55, 11)]
    for a, s, rad in sorted(drops, key=lambda q: q[2]):
        x, y = on_leaf(a, s)
        drop(img, x, y, rad)
    tip = base + dv * 1560 + pv * bend
    drop(img, float(tip[0]), float(tip[1]) + 44, 32, hanging=True, tip=(float(tip[0]), float(tip[1]) - 4))

    vig = 1 - 0.26 * (((xx / W - 0.5) / 0.75) ** 2 + ((yy / H - 0.48) / 0.8) ** 2)
    img *= np.clip(vig, 0.6, 1)[..., None]
    img = img * 0.95 + 8
    img[..., 0] *= 1.02
    img[..., 2] *= 0.95
    img += np.random.default_rng(5).normal(0, 3.0, (H, W)).astype(F)[..., None]
    final = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    final.save('/tmp/dauw-full.png')
    final.resize((550, 700), Image.LANCZOS).save('/tmp/dauw-preview.png')
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (480, 760, 1100):
        im = final if w == W else final.resize((w, round(H * w / W)), Image.LANCZOS)
        im.save(OUT / f'dauw-{w}.webp', quality=82, method=6)
        im.save(OUT / f'dauw-{w}.avif', quality=60)
    print('dauw done')


if __name__ == '__main__':
    main()
