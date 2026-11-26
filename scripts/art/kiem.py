"""Kiem: the hero picture for the first front-page design, and the leaf that rests on the big word.

A seedling with two leaves in crumbly soil against soft-focus greenery with warm light from the upper
right, in the manner of a macro photograph with a shallow depth of field. Nothing comes from a stock
library: the soil is a field of clods (Worley cells, lit with normals), the background is blurred
foliage, and the seedling is drawn from signed distances so its edges stay clean at any size.

    python3 scripts/art/kiem.py   ->  public/img/kiem-{w}.{avif,webp}, kiem-tegel-{w}.*, blad.webp
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.spatial import cKDTree

W, H = 2400, 1350
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
F = np.float32


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def noise(h, w, sigma, seed):
    """zero-mean noise with unit spread, smoothed to the given scale"""
    a = ndimage.gaussian_filter(np.random.default_rng(seed).standard_normal((h, w)).astype(F), sigma, mode='wrap')
    return a / max(1e-6, float(a.std()))


# ------------------------------------------------------------------ background: out-of-focus greenery
def background(r):
    s = 4
    w, h = W // s, H // s
    y, x = np.mgrid[0:h, 0:w].astype(F)
    x /= w
    y /= h
    dark, mid, pale, warm = (np.array(c, F) for c in ([18, 34, 19], [62, 90, 42], [150, 162, 96], [236, 226, 176]))
    t = np.clip(0.78 * x + 0.22 * (1 - y), 0, 1)
    base = lerp(dark, mid, sstep(0.0, 0.62, t)[..., None])
    base = lerp(base, pale, (sstep(0.5, 1.0, t) * 0.55)[..., None])
    glow = np.exp(-(((x - 0.9) / 0.34) ** 2 + ((y - 0.02) / 0.42) ** 2))
    base = lerp(base, warm, (glow ** 1.15 * 0.92)[..., None])
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

    def leaves(n, size, alpha, blur, lit_bias):
        layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for _ in range(n):
            cx, cy = r.uniform(-0.1, 1.1) * w, r.uniform(-0.15, 1.0) * h
            ln = r.uniform(*size)
            wd = ln * r.uniform(0.22, 0.42)
            ang = r.uniform(0, math.pi)
            lit = float(np.clip(0.7 * cx / w + 0.3 * (1 - cy / h) + lit_bias + r.normal(0, 0.16), 0, 1))
            col = lerp(np.array([14, 30, 15], F), np.array([112, 142, 62], F), lit)
            if lit > 0.68 and r.random() < 0.4:
                col = lerp(col, np.array([200, 200, 128], F), 0.45)
            pts = []
            for i in range(24):
                u = i / 23
                hw = wd * math.sin(math.pi * u) ** 0.8
                pts.append((u - 0.5, hw))
            pts = pts + [(u, -v) for u, v in reversed(pts)]
            ca, sa = math.cos(ang), math.sin(ang)
            poly = [(cx + ca * u * ln - sa * v, cy + sa * u * ln + ca * v) for u, v in pts]
            d.polygon(poly, fill=tuple(int(c) for c in col) + (int(r.uniform(*alpha)),))
        return layer.filter(ImageFilter.GaussianBlur(blur))

    img = img.convert('RGBA')
    img = Image.alpha_composite(img, leaves(220, (16, 70), (50, 130), 11, 0.0))
    img = Image.alpha_composite(img, leaves(70, (40, 110), (60, 140), 7, -0.25))
    up = img.convert('RGB').filter(ImageFilter.GaussianBlur(2)).resize((W, H), Image.BICUBIC)
    out = np.asarray(up).astype(F)
    # a soft beam of light falling in from the upper right
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    beam = np.exp(-((((xx / W - 0.72) * 0.8 + (yy / H) * 0.6) - 0.38) / 0.16) ** 2) * sstep(0.2, 1.0, xx / W)
    out = lerp(out, np.array([240, 232, 186], F), (beam * 0.16)[..., None])
    return out


# ------------------------------------------------------------------ soil: big moist clods, lit from the upper right
def soil_edge(r):
    xs = np.arange(W, dtype=F) / W
    prof = 0.79 - 0.10 * np.exp(-((xs - 0.235) / 0.27) ** 2) - 0.03 * np.exp(-((xs - 0.82) / 0.2) ** 2)
    prof = prof * H + noise(1, W, (0, 30), 3)[0] * 6
    edge = prof.copy()
    x = 0.0
    while x < W:  # clods sitting on the rim
        rad = (16 + 90 * max(0.0, (prof[int(min(W - 1, x))] / H - 0.62) / 0.38) ** 1.25) * r.uniform(0.5, 1.0)
        cx = x + rad
        lo, hi = int(max(0, cx - rad)), int(min(W, cx + rad))
        dx = np.arange(lo, hi) - cx
        bump = np.sqrt(np.clip(rad * rad - dx * dx, 0, None)) * r.uniform(0.3, 0.8)
        edge[lo:hi] = np.minimum(edge[lo:hi], prof[lo:hi] - bump)
        x += rad * r.uniform(1.2, 2.2)
    return prof, edge


def clod_size(y):
    return 14 + 118 * np.clip((y - 0.62 * H) / (0.38 * H), 0, 1) ** 1.25


def seeds(y0, scale, r):
    pts, y = [], float(y0) - 80
    while y < H + 60:
        s = float(clod_size(y)) * scale
        n = int(W / s * 1.15) + 2
        pts.append(np.column_stack([r.uniform(-s, W + s, n), y + r.uniform(0, s, n)]))
        y += s
    return np.vstack(pts).astype(F)


def soil(edge, r):
    y0 = int(edge.min()) - 40
    hh = H - y0
    ys, xs = np.mgrid[y0:H, 0:W].astype(F)
    size = clod_size(ys)

    def cells(scale, seed):
        amp = 0.2 * size * scale
        qx = xs + noise(hh, W, 34 * scale + 6, seed) * amp
        qy = ys + noise(hh, W, 34 * scale + 6, seed + 1) * amp
        pts = seeds(y0, scale, r)
        d, i = cKDTree(pts).query(np.column_stack([qx.ravel(), qy.ravel()]), k=2, workers=-1)
        e = (d[:, 0] / np.maximum(1e-3, 0.5 * (d[:, 0] + d[:, 1]))).reshape(hh, W).astype(F)
        return e, i[:, 0].reshape(hh, W), len(pts)

    e1, i1, n1 = cells(1.0, 21)
    e2, i2, n2 = cells(0.3, 31)
    ch1 = r.uniform(0.3, 1.35, n1).astype(F)
    tint = r.uniform(0, 1, n1).astype(F)
    wet = r.uniform(0.2, 1.0, n1).astype(F)
    lump1 = np.clip(1 - e1, 0, 1) ** 0.62 * ch1[i1]
    lump2 = np.clip(1 - e2, 0, 1) ** 0.7 * r.uniform(0.5, 1.1, n2).astype(F)[i2]
    height = size * (0.46 * lump1 + 0.14 * lump2 + 0.25 * noise(hh, W, 40, 43)) + noise(hh, W, 1.0, 41) * 1.1 + noise(hh, W, 2.2, 42) * 1.8
    gy, gx = np.gradient(ndimage.gaussian_filter(height, 0.7))
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lv = np.array([0.52, -0.58, 0.63], F)
    lv /= np.linalg.norm(lv)
    diffuse = np.clip(n @ lv, 0, 1)
    hv = lv + np.array([0, 0, 1], F)
    hv /= np.linalg.norm(hv)
    spec = np.clip(n @ hv, 0, 1) ** 42 * 0.45 * wet[i1]
    near = sstep(0.62 * H, H, ys)
    occl = lerp(ndimage.gaussian_filter(height, 5), ndimage.gaussian_filter(height, 16), near) - height
    occl = np.clip(occl / (0.2 * size), 0, 1)
    crev = sstep(0.86, 1.0, e1) * 0.4 + sstep(0.88, 1.0, e2) * 0.15
    # cast shadows: the light comes from the back right, so clods throw shade towards the front left
    shade = np.zeros_like(height)
    for k in range(1, 15):
        dx, dy = 3 * k, -2 * k
        sh = np.roll(np.roll(height, -dy, axis=0), -dx, axis=1) - height - k * 2.6
        shade = np.maximum(shade, np.clip(sh / 8, 0, 1))
    diffuse *= 1 - 0.75 * shade
    tc = tint[i1][..., None]
    dark = lerp(np.array([36, 25, 18], F), np.array([54, 38, 28], F), tc)
    lit = lerp(np.array([104, 76, 56], F), np.array([136, 103, 76], F), tc)
    col = lerp(dark, lit, (diffuse ** 1.15)[..., None])
    col *= (1 - 0.7 * occl)[..., None] * (1 - 0.55 * crev)[..., None]
    col *= (1 + 0.13 * noise(hh, W, 0.7, 44))[..., None]
    col += spec[..., None] * np.array([230, 214, 192], F)
    # grains of perlite and sand, sparse
    specks = np.zeros((hh, W), F)
    for _ in range(320):
        cx, cy = r.uniform(0, W), r.uniform(0, hh)
        rad = float(clod_size(cy + y0)) * r.uniform(0.04, 0.09)
        lo_x, hi_x, lo_y, hi_y = int(max(0, cx - rad - 1)), int(min(W, cx + rad + 2)), int(max(0, cy - rad - 1)), int(min(hh, cy + rad + 2))
        if hi_x <= lo_x or hi_y <= lo_y:
            continue
        gx2, gy2 = np.meshgrid(np.arange(lo_x, hi_x), np.arange(lo_y, hi_y))
        dd = np.sqrt((gx2 - cx) ** 2 + (gy2 - cy) ** 2) / rad
        specks[lo_y:hi_y, lo_x:hi_x] = np.maximum(specks[lo_y:hi_y, lo_x:hi_x], np.clip(1.4 - dd, 0, 1) * (1 - 0.35 * dd))
    col = lerp(col, np.array([206, 198, 182], F), (specks * 0.8)[..., None])
    full = np.zeros((H, W, 3), F)
    full[y0:] = col
    alpha = np.zeros((H, W), F)
    alpha[y0:] = np.clip(ys - edge[None, :] + 0.5, 0, 1)
    return full, alpha


# ------------------------------------------------------------------ the seedling, from signed distances
def bezier(p, n):
    t = np.linspace(0, 1, n, dtype=F)[:, None]
    p = [np.array(q, F) for q in p]
    return (1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] + 3 * (1 - t) * t ** 2 * p[2] + t ** 3 * p[3]


def stem_layer(ctrl, r0, r1):
    pts = bezier(ctrl, 1600)
    lo = np.floor(pts.min(0) - r0 - 3).astype(int)
    hi = np.ceil(pts.max(0) + r0 + 3).astype(int)
    gy, gx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]].astype(F)
    q = np.column_stack([gx.ravel(), gy.ravel()])
    d, j = cKDTree(pts).query(q, workers=-1)
    t = j / (len(pts) - 1)
    tan = np.gradient(pts, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    rel = q - pts[j]
    side = np.sign(tan[j, 0] * rel[:, 1] - tan[j, 1] * rel[:, 0])
    rad = lerp(r0, r1, t)
    s = np.clip(side * d / rad, -1, 1)
    a = np.clip(rad - d + 0.5, 0, 1)
    light = 0.42 + 0.58 * np.clip(0.6 * s + 0.8 * np.sqrt(1 - s * s), 0, 1)
    base = lerp(np.array([118, 122, 66], F), np.array([124, 168, 60], F), sstep(0.0, 0.18, t)[:, None])
    base = lerp(base, np.array([160, 198, 92], F), sstep(0.3, 1.0, t)[:, None])
    col = base * light[:, None] + np.exp(-((s - 0.45) / 0.13) ** 2)[:, None] * 34 + np.exp(-((s + 0.86) / 0.1) ** 2)[:, None] * 22
    shape = gx.shape
    return lo, np.dstack([col.reshape(shape + (3,)), a.reshape(shape)]), pts[-1]


def leaf_layer(base, theta, ln, half, droop, seed, bright_side=1):
    """one cotyledon: petiole at `base`, tip in direction `theta` (degrees, anticlockwise from +x)."""
    rr = np.random.default_rng(seed)
    th = math.radians(theta)
    d = np.array([math.cos(th), -math.sin(th)], F)
    p = np.array([math.sin(th), math.cos(th)], F)
    corners = [base, base + d * ln, base + d * ln * 0.5 + p * half * 1.6, base + d * ln * 0.5 - p * half * 1.6]
    cs = np.array(corners)
    margin = 10 + abs(droop) * ln + 0.35 * half
    lo = np.floor(cs.min(0) - margin).astype(int)
    hi = np.ceil(cs.max(0) + margin).astype(int)
    gy, gx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]].astype(F)
    rx, ry = gx - base[0], gy - base[1]
    a = (rx * d[0] + ry * d[1]) / ln
    b = rx * p[0] + ry * p[1]
    bend = droop * math.cos(th) * ln
    v = b - bend * np.clip(a, 0, 1) ** 2
    a0 = 0.1
    ap = np.clip((a - a0) / (1 - a0), 0, 1)
    pq, qq = 0.72, 0.95
    peak = (pq / (pq + qq)) ** pq * (qq / (pq + qq)) ** qq
    w = half * ap ** pq * (1 - ap) ** qq / peak
    w *= 1 + 0.014 * np.sin(ap * 37 + seed) * ap
    w = np.where(a < a0, 3.2, np.maximum(w, 3.2 * (1 - sstep(0, 0.12, ap))))
    w = np.where((a < -0.01) | (a > 1), -1, w)
    dw = np.gradient(w, axis=1) ** 2 + np.gradient(w, axis=0) ** 2
    alpha = np.clip((w - np.abs(v)) / np.sqrt(1 + dw) + 0.5, 0, 1)
    t = np.clip(np.abs(v) / np.maximum(w, 1e-3), 0, 1)
    half_lit = sstep(-1.5, 1.5, v * bright_side)  # 1 on the half that faces the light
    deep, mid, light, rim = (np.array(c, F) for c in ([60, 108, 42], [96, 148, 62], [150, 190, 98], [200, 220, 138]))
    col = lerp(mid, light, (t ** 1.5)[..., None] * 0.85)
    col = lerp(col, deep, ((1 - sstep(0, 0.2, ap)) * 0.45)[..., None])
    col *= (0.8 + 0.28 * half_lit)[..., None]
    col = lerp(col, light * 1.06, (sstep(0.75, 1.0, ap) * 0.35)[..., None])
    edge_px = w - np.abs(v)
    col = lerp(col, rim, (np.exp(-np.clip(edge_px, 0, None) / 2.4) * 0.55 * (a > a0))[..., None])
    midrib = np.exp(-(v / 1.7) ** 2) * (ap > 0.02) * (1 - sstep(0.75, 0.95, ap))
    col += midrib[..., None] * np.array([34, 30, 16], F)
    vs = (ap - 0.22 * t) * 6.5
    vein = np.exp(-((vs - np.round(vs)) * ln / 6.5 / 1.4) ** 2) * sstep(0.06, 0.2, t) * (1 - sstep(0.7, 0.95, t)) * (ap > 0.05)
    col += vein[..., None] * np.array([12, 12, 6], F)
    sheen = np.exp(-((ap - 0.42) / 0.26) ** 2 - ((t - 0.42) / 0.3) ** 2) * half_lit
    col += sheen[..., None] * np.array([26, 26, 18], F)
    tex = ndimage.gaussian_filter(rr.standard_normal(alpha.shape).astype(F), 1.1)
    col *= (1 + 0.035 * tex)[..., None]
    return lo, np.dstack([col, alpha])


def paste(dst_rgb, dst_a, lo, layer):
    """alpha-composite a float RGBA layer (top-left `lo`) onto a canvas, clipping at the edges"""
    h, w = layer.shape[:2]
    x0, y0 = int(lo[0]), int(lo[1])
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(dst_rgb.shape[1], x0 + w), min(dst_rgb.shape[0], y0 + h)
    if X1 <= X0 or Y1 <= Y0:
        return
    sub = layer[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
    a = sub[..., 3:4]
    dst_rgb[Y0:Y1, X0:X1] = lerp(dst_rgb[Y0:Y1, X0:X1], sub[..., :3], a)
    if dst_a is not None:
        dst_a[Y0:Y1, X0:X1] = dst_a[Y0:Y1, X0:X1] + (1 - dst_a[Y0:Y1, X0:X1]) * a[..., 0]


def depth_of_field(img, sigma, y_from):
    levels = [0, 1.2, 2.5, 4.5, 7.5, 11.5, 16.5]
    part = img[y_from:]
    sg = np.clip(sigma[y_from:], 0, levels[-1])
    stack = [part] + [np.dstack([ndimage.gaussian_filter(part[..., c], s) for c in range(3)]) for s in levels[1:]]
    # linear interpolation between the two neighbouring blur levels
    out = np.zeros_like(part)
    idx = np.searchsorted(levels, sg, side='right') - 1
    idx = np.clip(idx, 0, len(levels) - 2)
    lo_v = np.array(levels, F)[idx]
    hi_v = np.array(levels, F)[idx + 1]
    f = np.clip((sg - lo_v) / (hi_v - lo_v), 0, 1)
    for k in range(len(levels) - 1):
        m = idx == k
        if not m.any():
            continue
        out[m] = stack[k][m] * (1 - f[m])[:, None] + stack[k + 1][m] * f[m][:, None]
    res = img.copy()
    res[y_from:] = out
    return res


def main():
    r = np.random.default_rng(1982)
    bg = background(r)
    prof, edge = soil_edge(r)
    so, sa = soil(edge, r)
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    # the background darkens a little towards the ground
    bg *= (1 - 0.3 * sstep(0.5, 0.85, yy / H))[..., None]
    img = lerp(bg, so, sa[..., None])

    sx = int(W * 0.2)
    sy = float(prof[sx]) + 4
    # depth of field: sharp where the seedling stands, softer to the right, behind and in front
    sig = 0.6 + 15.5 * sstep(0.0, 1.0, (xx - sx) / (0.72 * W)) ** 1.15 + 6.5 * sstep(0.0, 1.0, (sx - xx) / (0.3 * W)) ** 2
    sig += 5.5 * sstep(0.0, 1.0, (yy - sy - 40) / (H - sy)) ** 1.6
    sig = np.where(yy < edge[None, :] - 30, 0, sig)
    img = depth_of_field(img, sig.astype(F), int(edge.min()) - 60)

    # the seedling: shadow first, then stem and leaves
    plant = np.zeros((H, W, 3), F)
    pa = np.zeros((H, W), F)
    crumb = sy + 4 + noise(1, W, 2.5, 77)[0] * 5
    lo, st, top = stem_layer([(sx, sy + 34), (sx - 15, sy - 84), (sx + 18, sy - 180), (sx + 4, sy - 252)], 9.4, 7.0)
    sh_y = np.arange(lo[1], lo[1] + st.shape[0])[:, None]
    sh_x = np.clip(np.arange(lo[0], lo[0] + st.shape[1]), 0, W - 1)[None, :]
    st[..., 3] *= np.clip(crumb[sh_x] - sh_y + 0.5, 0, 1)
    ground = img.copy()
    paste(plant, pa, lo, st)
    for theta, ln, half, droop, seed, side in [(146, 300, 77, 0.12, 5, -1), (23, 268, 68, 0.1, 9, 1)]:
        lo, lf = leaf_layer(top + np.array([0, 2], F), theta, ln, half, droop, seed, side)
        paste(plant, pa, lo, lf)
    shadow = ndimage.gaussian_filter(np.roll(np.roll(pa, 22, axis=0), -50, axis=1), 18) * 0.4
    shadow *= sa * sstep(sy - 30, sy + 30, yy)
    img *= (1 - shadow)[..., None]
    contact = np.exp(-(((xx - sx) / 34) ** 2 + ((yy - sy - 6) / 9) ** 2)) * 0.45
    img *= (1 - contact)[..., None]
    img = lerp(img, plant, pa[..., None])
    del ground

    # finish: lifted blacks, a warm grade, a gentle vignette and film grain
    vig = 1 - 0.3 * (((xx / W - 0.55) / 0.8) ** 2 + ((yy / H - 0.45) / 0.85) ** 2)
    img *= np.clip(vig, 0.6, 1)[..., None]
    img = img * 0.94 + 9
    img[..., 0] *= 1.025
    img[..., 2] *= 0.95
    img += np.random.default_rng(7).normal(0, 3.4, (H, W)).astype(F)[..., None]
    final = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    final.save('/tmp/kiem-full.png')
    final.resize((1200, 675), Image.LANCZOS).save('/tmp/kiem-preview.png')
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (2400, 1600, 1100, 760):
        im = final if w == W else final.resize((w, round(H * w / W)), Image.LANCZOS)
        im.save(OUT / f'kiem-{w}.webp', quality=80, method=6)
        im.save(OUT / f'kiem-{w}.avif', quality=58)
    # a square tile around the seedling for the grid design
    tile = final.crop((sx - 430, int(sy) - 590, sx + 430, int(sy) + 270))
    for w in (900, 600):
        im = tile.resize((w, w), Image.LANCZOS)
        im.save(OUT / f'kiem-tegel-{w}.webp', quality=80, method=6)
        im.save(OUT / f'kiem-tegel-{w}.avif', quality=58)
    tile.resize((600, 600), Image.LANCZOS).save('/tmp/kiem-tegel.png')

    # the loose leaf for the big word: on a transparent canvas
    cw, chh = 760, 640
    rgb = np.zeros((chh, cw, 3), F)
    al = np.zeros((chh, cw), F)
    lo, lf = leaf_layer(np.array([60, 560], F), 38, 560, 128, 0.1, 13, -1)
    paste(rgb, al, lo, lf)
    out = np.dstack([np.clip(rgb, 0, 255), np.clip(al * 255, 0, 255)]).astype(np.uint8)
    leaf = Image.fromarray(out, 'RGBA')
    bbox = leaf.getbbox()
    leaf = leaf.crop(bbox)
    leaf.save(OUT / 'blad.webp', quality=88, method=6)
    leaf.save('/tmp/blad.png')
    print('kiem done', final.size, 'leaf', leaf.size)


if __name__ == '__main__':
    main()
