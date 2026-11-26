"""Bollen: a Dutch tulip field in spring, beds of colour running to the horizon under a light sky,
as a photograph with a shallow depth of field would show it. One of the pictures that take turns in
the arch of the front-page hero.

The field is built in metres and projected through a pinhole camera standing in a furrow between two
beds. It is drawn in depth slices, far to near, and every slice gets the blur of a lens focused at
three metres.

    python3 scripts/art/bollen.py  ->  public/img/bollen-{w}.{avif,webp}  (portrait, 11:14)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1100, 1400
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
rng = np.random.default_rng(1956)
VX, VY, FOC, CAM = W * 0.5, H * 0.35, 900.0, 0.95
Z_FOCUS = 3.0
BED, FURROW = 1.05, 0.42
# beds from the centre outwards: left side, right side
LEFT = ['red', 'yellow', 'pink', 'white', 'purple', 'red', 'orange', 'yellow', 'pink', 'red']
RIGHT = ['yellow', 'red', 'orange', 'pink', 'red', 'white', 'yellow', 'purple', 'red', 'pink']
COL = {
    'red': ((206, 34, 44), (236, 92, 84)),
    'yellow': ((246, 196, 38), (252, 228, 120)),
    'pink': ((232, 98, 150), (246, 170, 200)),
    'white': ((244, 240, 232), (255, 255, 250)),
    'purple': ((128, 64, 150), (176, 128, 196)),
    'orange': ((240, 120, 36), (250, 170, 90)),
}


def proj(x, y, z):
    return VX + FOC * x / z, VY + FOC * (CAM - y) / z


def haze(col, z):
    t = 1 - np.exp(-z / 70)
    return tuple(int(c + (h - c) * t) for c, h in zip(col, (214, 226, 236)))


def blur_for(z):
    return max(1.3, 22 * abs(1 / z - 1 / Z_FOCUS))


def beds():
    """(x0, x1, colour) for every bed, the camera stands in the furrow at x = 0"""
    out = []
    for i, c in enumerate(LEFT):
        x1 = -FURROW / 2 - i * (BED + FURROW)
        out.append((x1 - BED, x1, c))
    for i, c in enumerate(RIGHT):
        x0 = FURROW / 2 + i * (BED + FURROW)
        out.append((x0, x0 + BED, c))
    return out


def sky():
    im = Image.new('RGB', (W, H), (0, 0, 0))
    a = np.zeros((H, W, 3), np.float32)
    yy = np.arange(H, dtype=np.float32)[:, None] / VY
    top, low = np.array([118, 164, 214], np.float32), np.array([220, 232, 238], np.float32)
    t = np.clip(yy, 0, 1) ** 1.6
    a[:] = (top + (low - top) * t[..., None])
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im, 'RGBA')
    for _ in range(16):  # soft fair-weather clouds
        cx, cy = rng.uniform(-0.1, 1.1) * W, rng.uniform(0.04, 0.26) * H
        rw, rh = rng.uniform(80, 220), rng.uniform(26, 60)
        for _k in range(5):
            ox, oy = rng.normal(0, rw * 0.35), rng.normal(0, rh * 0.25)
            d.ellipse([cx + ox - rw * 0.6, cy + oy - rh, cx + ox + rw * 0.6, cy + oy + rh * 0.7], fill=(250, 251, 252, 70))
    im = im.filter(ImageFilter.GaussianBlur(18))
    d = ImageDraw.Draw(im)
    # the far edge of the land: a line of trees, a farm and a mill, blue with distance
    hz = VY
    pts = [(0, hz + 4)]
    x = 0
    while x < W:
        h = rng.uniform(6, 20) if rng.random() < 0.7 else rng.uniform(1, 4)
        pts.append((x, hz - h))
        x += rng.uniform(8, 26)
    pts += [(W, hz + 4)]
    d.polygon(pts, fill=(118, 140, 132))
    fx = W * 0.28
    d.rectangle([fx, hz - 16, fx + 46, hz + 2], fill=(132, 126, 124))
    d.polygon([(fx - 4, hz - 16), (fx + 23, hz - 32), (fx + 50, hz - 16)], fill=(120, 104, 100))
    mx, my = W * 0.71, hz
    d.polygon([(mx - 10, my + 2), (mx - 6, my - 58), (mx + 6, my - 58), (mx + 10, my + 2)], fill=(96, 104, 108))
    d.ellipse([mx - 8, my - 66, mx + 8, my - 52], fill=(96, 104, 108))
    for ang in (0.5, 2.07, 3.64, 5.21):
        ex, ey = mx + 44 * np.cos(ang), my - 59 + 44 * np.sin(ang)
        d.line([(mx, my - 59), (ex, ey)], fill=(96, 104, 108), width=4)
    return im.filter(ImageFilter.GaussianBlur(blur_for(120) * 0.6))


def draw_tulip(d, x, z, kind, mono=False):
    hz = (lambda c, zz: 255) if mono else haze
    hgt = rng.uniform(0.36, 0.46)
    bx, by = proj(x, 0.0, z)
    tx, ty = proj(x + rng.normal(0, 0.012), hgt, z)
    s = FOC / z
    lean = rng.normal(0, 0.01)
    stem = (64 + rng.integers(0, 20), 120 + rng.integers(0, 26), 52)
    d.line([(bx, by), (tx + lean * s, ty)], fill=hz(stem, z), width=max(1, int(0.009 * s)))
    # two broad leaves at the foot
    for side in (-1, 1):
        lx, ly = proj(x + side * 0.03, 0.1, z)
        lw, lh = 0.05 * s, 0.16 * s
        d.ellipse([lx - lw * (0.3 if side < 0 else 0.7), ly - lh, lx + lw * (0.7 if side < 0 else 0.3), ly + lh * 0.4], fill=hz((58, 112, 58), z))
    base, light = COL[kind]
    r = rng.uniform(0.026, 0.034) * s
    cx, cy = tx + lean * s, ty
    # the cup: two outer petals and one in front, a light edge on the left where the sun comes from
    for ox in (-0.45, 0.45):
        d.ellipse([cx + ox * r - r * 0.62, cy - r * 1.25, cx + ox * r + r * 0.62, cy + r * 0.55], fill=hz(tuple(int(c * 0.86) for c in base), z))
    d.ellipse([cx - r * 0.7, cy - r * 1.15, cx + r * 0.7, cy + r * 0.65], fill=hz(base, z))
    d.ellipse([cx - r * 0.55, cy - r * 1.05, cx - r * 0.05, cy + r * 0.1], fill=hz(light, z))


def main():
    out = np.asarray(sky(), dtype=np.float32)
    bs = beds()
    edges = [400, 160, 90, 60, 42, 30, 22, 16.5, 12.5, 9.6, 7.6, 6.1, 5.0, 4.2, 3.6, 3.2, 2.85, 2.5, 2.2, 1.95, 1.72, 1.52, 1.35, 1.2, 1.06, 0.94, 0.84, 0.75, 0.67, 0.6]
    for far, near in zip(edges, edges[1:]):
        rgb = Image.new('RGB', (W, H), (0, 0, 0))
        al = Image.new('L', (W, H), 0)
        d, da = ImageDraw.Draw(rgb), ImageDraw.Draw(al)
        zm = (far + near) / 2
        fz = far * 1.1  # every slice reaches a little past its far edge, so no seam shows where slices meet
        # the ground of this slice: furrows of earth, with clods; beds of green leaves topped with colour
        ground = [proj(-60, 0, near), proj(60, 0, near), proj(60, 0, fz), proj(-60, 0, fz)]
        d.polygon(ground, fill=haze((112, 86, 64), zm))
        da.polygon(ground, fill=255)
        if far < 40:
            for _ in range(int(160 * (far - near))):
                cz = rng.uniform(near, far)
                cxm = rng.uniform(-FURROW / 2, FURROW / 2)
                px, py = proj(cxm, 0, cz)
                cr = FOC * rng.uniform(0.008, 0.02) / cz
                tone = rng.uniform(0.75, 1.2)
                d.ellipse([px - cr, py - cr * 0.55, px + cr, py + cr * 0.45], fill=haze(tuple(int(min(255, c * tone)) for c in (112, 86, 64)), cz))
        for x0, x1, kind in bs:
            top = [proj(x0, 0.2, near), proj(x1, 0.2, near), proj(x1, 0.2, fz), proj(x0, 0.2, fz)]
            front = [proj(x0, 0.0, near), proj(x1, 0.0, near), proj(x1, 0.2, near), proj(x0, 0.2, near)]
            side_x = x1 if x1 < 0 else x0
            side = [proj(side_x, 0.0, near), proj(side_x, 0.0, fz), proj(side_x, 0.2, fz), proj(side_x, 0.2, near)]
            for poly, col in ((side, (52, 98, 52)), (top, (62, 116, 58)), (front, (56, 106, 54))):
                d.polygon(poly, fill=haze(col, zm))
                da.polygon(poly, fill=255)
            if far > 22:
                # too far for single flowers: a band of colour on top of the bed
                band = [proj(x0, 0.4, near), proj(x1, 0.4, near), proj(x1, 0.4, fz), proj(x0, 0.4, fz)]
                band_lo = [proj(x0, 0.3, near), proj(x1, 0.3, near), proj(x1, 0.3, fz), proj(x0, 0.3, fz)]
                poly = [band_lo[0], band_lo[1], band[1], band[2], band[3], band[0]]
                d.polygon(poly, fill=haze(COL[kind][0], zm))
                da.polygon(poly, fill=255)
                continue
            step = 0.075 if near < 3 else 0.1 if near < 6 else 0.14 if near < 12 else 0.2
            z = near
            while z < far:
                for x in np.arange(x0 + 0.05, x1 - 0.03, step):
                    xx = x + rng.uniform(-0.025, 0.025)
                    zz = z + rng.uniform(-0.02, 0.02)
                    sx, _ = proj(xx, 0.4, zz)
                    if -40 < sx < W + 40:
                        state = rng.bit_generator.state
                        draw_tulip(d, xx, zz, kind)
                        rng.bit_generator.state = state
                        draw_tulip(da, xx, zz, kind, mono=True)
                z += step
        s = blur_for(zm)
        if s > 0.4:
            rgb = rgb.filter(ImageFilter.GaussianBlur(s))
            al = al.filter(ImageFilter.GaussianBlur(s))
        a = np.asarray(al, dtype=np.float32)[..., None] / 255
        out = out * (1 - a) + np.asarray(rgb, dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sun = np.exp(-(((xx / W - 0.2) / 0.5) ** 2 + ((yy / H - 0.08) / 0.3) ** 2))
    out = out + sun[..., None] * np.array([20, 16, 6], np.float32)
    vig = 1 - 0.2 * (((xx / W - 0.5) / 0.7) ** 2 + ((yy / H - 0.5) / 0.75) ** 2)
    out *= vig[..., None]
    grey = out.mean(axis=2, keepdims=True)
    out = grey + (out - grey) * 1.08
    out += rng.normal(0, 2.6, (H, W)).astype(np.float32)[..., None]
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    img.save('/tmp/bollen-full.png')
    img.resize((550, 700), Image.LANCZOS).save('/tmp/bollen-preview.png')
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (480, 760, 1100):
        im = img if w == W else img.resize((w, round(H * w / W)), Image.LANCZOS)
        im.save(OUT / f'bollen-{w}.webp', quality=80, method=6)
        im.save(OUT / f'bollen-{w}.avif', quality=58)
    print('bollen done')


if __name__ == '__main__':
    main()
