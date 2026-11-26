"""Kas: rows of flowering pot plants on benches in a greenhouse, as a photograph with a shallow depth
of field would show them. Used as a tile in the third front-page design.

The scene is built in metres and projected through a simple pinhole camera; it is drawn in depth
slices, far to near, and every slice gets the blur a lens focused at three metres would give it.

    python3 scripts/art/kas.py  ->  public/img/kas-tegel-{w}.{avif,webp}
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 1200
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
rng = np.random.default_rng(7)
VX, VY, FOC, CAM = W * 0.5, H * 0.22, 980.0, 1.55
Z_FOCUS = 2.9


def proj(x, y, z):
    return VX + FOC * x / z, VY + FOC * (CAM - y) / z


def haze(col, z):
    t = 1 - np.exp(-z / 26)
    return tuple(int(c + (h - c) * t) for c, h in zip(col, (226, 232, 222)))


def blur_for(z):
    return max(2.4, 40 * abs(1 / z - 1 / Z_FOCUS))


def background():
    im = Image.new('RGB', (W, H), (206, 214, 204))
    d = ImageDraw.Draw(im)
    # glass roof: light, with the gutters running to the far end and the trusses across
    for k in range(60):
        y = VY - (H * 0.9) * (k / 60) ** 1.4
        c = int(226 - 26 * (k / 60))
        d.rectangle([0, y - 14, W, y + 14], fill=(c, c + 6, c + 2))
    d.rectangle([0, VY - 4, W, H], fill=(150, 152, 144))
    for x in np.arange(-8.8, 9, 2.2):
        x0, y0 = proj(x, 4.6, 1.0)
        x1, y1 = proj(x, 4.6, 60)
        d.line([(x0, y0), (x1, y1)], fill=(168, 176, 170), width=4)
    for z in np.arange(2, 60, 3.2):
        xa, ya = proj(-12, 5.0, z)
        xb, yb = proj(12, 5.0, z)
        d.line([(xa, ya), (xb, yb)], fill=(160, 168, 164), width=max(1, int(10 / z)))
    # the far glass wall, glowing
    xa, ya = proj(-12, 6, 60)
    xb, yb = proj(12, 0, 60)
    d.rectangle([xa, ya, xb, yb], fill=(244, 246, 236))
    # aisles of concrete between the benches
    return im.filter(ImageFilter.GaussianBlur(18))


BENCHES = [(c - 0.85, c + 0.85) for c in (-4.4, -2.2, 0.0, 2.2, 4.4)]
KINDS = [
    ((214, 52, 124), (238, 150, 196)),   # cyclamen, magenta and pink
    ((246, 242, 240), (236, 220, 232)),  # white orchids
    ((206, 36, 48), (228, 84, 76)),      # red
    ((150, 82, 176), (196, 150, 214)),   # purple
]


def plants():
    items = []
    for b, (x0, x1) in enumerate(BENCHES):
        kind = KINDS[[3, 1, 0, 2, 0][b]]
        z = 0.62
        while z < 58:
            step = 0.24 if z < 10 else 0.32
            for x in np.arange(x0 + 0.12, x1 - 0.08, 0.24):
                items.append((z + rng.uniform(-0.04, 0.04), x + rng.uniform(-0.04, 0.04), kind))
            z += step
    return items


def draw_plant(d, z, x, kind, mono=False):
    leaf = (38 + rng.integers(0, 18), 78 + rng.integers(0, 26), 44 + rng.integers(0, 14))
    hz = (lambda c, z: 255) if mono else haze
    sx, sy = proj(x, 0.9, z)
    r = FOC * 0.13 / z
    for k in range(3):
        ox, oy = rng.normal(0, 0.35) * r, rng.normal(0, 0.15) * r
        sh = tuple(int(c * f) for c, f in zip(leaf, (0.8 + 0.25 * k,) * 3))
        d.ellipse([sx + ox - r * 0.8, sy + oy - r * 0.5, sx + ox + r * 0.8, sy + oy + r * 0.5], fill=hz(sh, z))
    for _ in range(rng.integers(5, 9)):
        fx = x + rng.normal(0, 0.055)
        fy = 0.98 + rng.uniform(0.05, 0.18)
        px, py = proj(fx, fy, z)
        fr = FOC * rng.uniform(0.022, 0.034) / z
        col = kind[0] if rng.random() < 0.72 else kind[1]
        for _p in range(3):
            qx, qy = px + rng.normal(0, 0.45) * fr, py + rng.normal(0, 0.35) * fr
            d.ellipse([qx - fr * 0.75, qy - fr * 0.9, qx + fr * 0.75, qy + fr * 0.6], fill=hz(col, z))
        hl = tuple(min(255, int(c + (255 - c) * 0.3)) for c in col)
        d.ellipse([px - fr * 0.45, py - fr * 0.85, px + fr * 0.2, py - fr * 0.2], fill=hz(hl, z))


def main():
    out = np.asarray(background(), dtype=np.float32)
    items = sorted(plants(), key=lambda p: -p[0])
    edges = [60, 40, 28, 20, 14.5, 10.5, 7.8, 5.9, 4.6, 3.7, 3.2, 2.7, 2.35, 2.0, 1.7, 1.45, 1.25, 1.05, 0.88, 0.74, 0.6]
    for far, near in zip(edges, edges[1:]):
        rgb = Image.new('RGB', (W, H), (0, 0, 0))
        al = Image.new('L', (W, H), 0)
        d, da = ImageDraw.Draw(rgb), ImageDraw.Draw(al)
        # bench edges in this slice
        for x0, x1 in BENCHES:
            pts = [proj(x0, 0.82, near), proj(x1, 0.82, near), proj(x1, 0.82, far), proj(x0, 0.82, far)]
            if x0 < 0 < x1:
                d.polygon(pts, fill=haze((58, 86, 56), (far + near) / 2))
                da.polygon(pts, fill=255)
                continue
            xs = x1 if x1 < 0 else x0
            side = [proj(xs, 0.82, near), proj(xs, 0.82, far), proj(xs, 0.0, far), proj(xs, 0.0, near)]
            floor = [proj(xs, 0.0, near), proj(xs, 0.0, far), proj(xs + (0.4 if x1 < 0 else -0.4), 0.0, far), proj(xs + (0.4 if x1 < 0 else -0.4), 0.0, near)]
            for poly, col in ((floor, (126, 128, 120)), (side, (52, 56, 50)), (pts, (58, 86, 56))):
                d.polygon(poly, fill=haze(col, (far + near) / 2))
                da.polygon(poly, fill=255)
        for z, x, kind in items:
            if near <= z < far:
                state = rng.bit_generator.state
                draw_plant(d, z, x, kind)
                rng.bit_generator.state = state
                draw_plant(da, z, x, kind, mono=True)
        s = blur_for((far + near) / 2)
        if s > 0.4:
            rgb = rgb.filter(ImageFilter.GaussianBlur(s))
            al = al.filter(ImageFilter.GaussianBlur(s))
        a = np.asarray(al, dtype=np.float32)[..., None] / 255
        out = out * (1 - a) + np.asarray(rgb, dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    glow = np.exp(-(((xx / W - 0.5) / 0.5) ** 2 + ((yy / H - 0.3) / 0.35) ** 2))
    out = out + glow[..., None] * np.array([18, 16, 8], np.float32)
    vig = 1 - 0.22 * (((xx / W - 0.5) / 0.7) ** 2 + ((yy / H - 0.5) / 0.7) ** 2)
    out *= vig[..., None]
    out += rng.normal(0, 3.0, (H, W)).astype(np.float32)[..., None]
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    img.save('/tmp/kas-full.png')
    img.resize((800, 600), Image.LANCZOS).save('/tmp/kas-preview.png')
    tile = img.crop(((W - H) // 2, 0, (W - H) // 2 + H, H))
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (900, 600):
        im = tile.resize((w, w), Image.LANCZOS)
        im.save(OUT / f'kas-tegel-{w}.webp', quality=80, method=6)
        im.save(OUT / f'kas-tegel-{w}.avif', quality=58)
    print('kas done')


if __name__ == '__main__':
    main()
