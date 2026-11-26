"""Kaart: a watercolour site plan of Campo's warehouse in Nootdorp; a round cut-out of it takes turns in the
front-page hero, with Nootdorp marked like the globe that used to stand there.

Painted from above like a landscape architect's plan: the loods with trucks at the docks, the yard and
the road, greenhouses and round water basins of the growers nearby, fields with ditches, and trees.
Watercolour is imitated with washes: wobbly edges, pigment that pools at the rim, granulation, blooms,
small gaps of bare paper between areas, and a thin pen line for the buildings and trucks.

    python3 scripts/art/kaart.py  ->  public/img/kaart-{w}.{avif,webp}  (square, around the warehouse)
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

W, H = 2000, 1500
OUT = Path(__file__).resolve().parents[2] / 'public' / 'img'
F = np.float32
rng = np.random.default_rng(1982)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def noise(sigma, seed):
    a = ndimage.gaussian_filter(np.random.default_rng(seed).standard_normal((H, W)).astype(F), sigma, mode='wrap')
    return a / max(1e-6, float(a.std()))


N_EDGE, N_BLOOM, N_GRAIN, N_DAB = noise(3.2, 1), noise(38, 2), noise(0.9, 3), noise(2.4, 4)


def P(u, v):
    return (u * W, v * H)


class Mask:
    def __init__(self):
        self.im = Image.new('L', (W, H), 0)
        self.d = ImageDraw.Draw(self.im)

    def poly(self, pts, fill=255):
        self.d.polygon([P(u, v) for u, v in pts], fill=fill)
        return self

    def rect(self, u0, v0, u1, v1, fill=255):
        return self.poly([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], fill)

    def circle(self, u, v, r, fill=255):
        x, y = P(u, v)
        self.d.ellipse([x - r, y - r, x + r, y + r], fill=fill)
        return self

    def line(self, pts, width, fill=255):
        self.d.line([P(u, v) for u, v in pts], fill=fill, width=int(width), joint='curve')
        return self

    def arr(self):
        return np.asarray(self.im, dtype=F) / 255


def wash(img, m, color, dens=1.0, edge=0.6, bloom=0.3, gran=0.14, wobble=0.2, gap=0.0, seed=0, dabs=0.0):
    """lay one transparent wash of `color` (0..255, its full-strength tint) where the mask is"""
    ys, xs = np.nonzero(m > 0.01)
    if len(xs) == 0:
        return
    pad = 24
    y0, y1, x0, x1 = max(0, ys.min() - pad), min(H, ys.max() + pad), max(0, xs.min() - pad), min(W, xs.max() + pad)
    sub = m[y0:y1, x0:x1]
    sh = (seed * 97) % 400, (seed * 61) % 400

    def nz(n):
        return np.roll(np.roll(n, sh[0], 0), sh[1], 1)[y0:y1, x0:x1]

    soft = ndimage.gaussian_filter(sub, 1.8)
    mw = np.clip((soft - 0.5 - gap + wobble * 0.5 * nz(N_EDGE)) * 5.5 + 0.5, 0, 1)
    rim = np.clip(mw - ndimage.gaussian_filter(mw, 4.5), 0, 1) * 2.4
    d = mw * (1 - bloom * 0.5 + bloom * sstep(-1.2, 1.2, nz(N_BLOOM)))
    d *= 1 + gran * nz(N_GRAIN)
    if dabs:
        d *= 1 - dabs * 0.5 + dabs * sstep(-0.6, 1.1, nz(N_DAB))
    d += edge * rim
    c = np.clip(np.array(color, F) / 255, 0.02, 1)
    img[y0:y1, x0:x1] *= np.exp(np.log(c)[None, None, :] * (d * dens)[..., None])


class Pen:
    """ink at twice the size, so the lines are smooth after scaling down"""

    def __init__(self):
        self.im = Image.new('L', (W * 2, H * 2), 0)
        self.d = ImageDraw.Draw(self.im)

    def _wob(self, pts, amp=0.7):
        out = []
        for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
            x0, y0, x1, y1 = u0 * W * 2, v0 * H * 2, u1 * W * 2, v1 * H * 2
            n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 30))
            nx, ny = -(y1 - y0), x1 - x0
            ln = math.hypot(nx, ny) or 1
            nx, ny = nx / ln, ny / ln
            for i in range(n):
                t = i / n
                o = rng.normal(0, amp)
                out.append((x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o))
        out.append((pts[-1][0] * W * 2, pts[-1][1] * H * 2))
        return out

    def line(self, pts, width=2.0, ink=255, wob=0.7):
        self.d.line(self._wob(pts, wob), fill=ink, width=max(1, int(width * 2)), joint='curve')

    def rect(self, u0, v0, u1, v1, width=2.0, ink=255, fill=None):
        if fill is not None:
            self.d.rectangle([u0 * W * 2, v0 * H * 2, u1 * W * 2, v1 * H * 2], fill=fill)
        self.line([(u0, v0), (u1, v0), (u1, v1), (u0, v1), (u0, v0)], width, ink)

    def circle(self, u, v, r, width=2.0, ink=255):
        x, y = u * W * 2, v * H * 2
        self.d.ellipse([x - r * 2, y - r * 2, x + r * 2, y + r * 2], outline=ink, width=max(1, int(width * 2)))

    def apply(self, img, color):
        a = np.asarray(self.im.resize((W, H), Image.LANCZOS), dtype=F) / 255
        c = np.array(color, F) / 255
        img *= 1 - a[..., None] * (1 - c)


def painted_mask():
    return Mask().poly([(0.025, 0.035), (0.5, 0.022), (0.975, 0.032), (0.982, 0.5), (0.972, 0.968), (0.5, 0.978), (0.03, 0.965), (0.02, 0.5)]).arr()


def main():
    img = np.ones((H, W, 3), F) * (np.array([247, 246, 242], F) / 255)
    img *= (1 + 0.012 * N_GRAIN + 0.01 * noise(9, 5))[..., None]

    # ---------------------------------------------------------------- the plan, in fractions of the sheet
    road_v = lambda u: 0.655 + 0.018 * math.sin(u * 2.6 + 0.4)
    road_pts = [(u / 40 * 1.1 - 0.05, road_v(u / 40 * 1.1 - 0.05)) for u in range(41)]
    road = Mask().line(road_pts, 0.044 * H).arr()
    dashes = Mask()
    for k in range(40):
        u = -0.05 + k * 0.03
        dashes.line([(u, road_v(u)), (u + 0.014, road_v(u + 0.014))], 3)
    road = np.clip(road - dashes.arr(), 0, 1) * painted_mask()

    loods = (0.5, 0.2, 0.79, 0.5)
    office = (0.435, 0.39, 0.5, 0.5)
    yard = Mask().rect(0.47, 0.5, 0.81, 0.635).arr()
    lines = Mask()
    for k in range(9):
        u = 0.505 + k * 0.034
        lines.line([(u, 0.565), (u, 0.62)], 2)
    yard = np.clip(yard - lines.arr() - road, 0, 1)
    parking = Mask().rect(0.385, 0.515, 0.468, 0.6).arr()

    kassen = [(0.05, 0.07, 0.31, 0.35), (0.05, 0.4, 0.215, 0.585), (0.245, 0.4, 0.41, 0.585), (0.83, 0.07, 0.965, 0.33)]
    basins = [(0.365, 0.215, 62), (0.9, 0.43, 44)]

    painted = painted_mask()
    built = Mask()
    for k in kassen:
        built.rect(*k)
    built.rect(*loods).rect(*office)
    for u, v, rr in basins:
        built.circle(u, v, rr + 6)
    built_a = built.arr()

    # fields in the south, divided by ditches
    field_top = 0.715
    fields = []
    edges = [0.03, 0.2, 0.37, 0.52, 0.7, 0.86, 0.975]
    for i in range(len(edges) - 1):
        fields.append((edges[i], field_top, edges[i + 1], 0.968))

    # ---------------------------------------------------------------- washes, light to dark
    grass = np.clip(painted - road - yard - parking - built_a, 0, 1)
    grass[int(field_top * H) - 6:] *= 0  # the fields get their own colours
    wash(img, grass, (196, 216, 166), dens=0.95, bloom=0.45, seed=1, gap=0.04)
    wash(img, grass * (N_BLOOM > 0.6), (214, 222, 160), dens=0.6, bloom=0.5, seed=2, gap=0.05)
    tones = [(186, 210, 150), (214, 214, 156), (176, 204, 146), (204, 214, 160), (190, 212, 152), (220, 216, 166)]
    for i, (u0, v0, u1, v1) in enumerate(fields):
        m = Mask().rect(u0 + 0.003, v0 + 0.008, u1 - 0.003, v1).arr() * painted
        wash(img, m, tones[i], dens=1.0, bloom=0.35, seed=10 + i, gap=0.03)
    wash(img, road, (214, 208, 196), dens=0.9, bloom=0.2, seed=20, gap=0.02)
    wash(img, yard, (204, 202, 198), dens=0.95, bloom=0.25, seed=21, gap=0.03)
    wash(img, parking, (206, 203, 196), dens=0.85, seed=22, gap=0.03)

    # ditches along the road and between the fields, a canal to the east
    water = Mask()
    water.line([(0.03, field_top), (0.975, field_top)], 7)
    for e in edges[1:-1]:
        water.line([(e, field_top), (e, 0.968)], 6)
    water.line([(0.03, 0.03), (0.03, 0.97)], 0)
    wa = water.arr() * painted
    wash(img, wa, (138, 182, 210), dens=1.0, edge=0.9, bloom=0.2, seed=30, wobble=0.12)
    for u, v, rr in basins:
        m = Mask().circle(u, v, rr).arr()
        wash(img, m, (128, 176, 208), dens=1.0, edge=1.0, bloom=0.4, seed=31 + int(rr))
        hi = Mask().circle(u - rr * 0.25 / W, v - rr * 0.3 / H, rr * 0.45).arr()
        wash(img, m * (1 - hi), (170, 200, 222), dens=0.5, seed=33)

    # greenhouses: pale glass with the ridges of the roof
    for i, k in enumerate(kassen):
        m = Mask().rect(*k).arr()
        wash(img, m, (226, 236, 240), dens=1.0, edge=0.5, bloom=0.6, seed=40 + i, wobble=0.08)
        panes = Mask()
        u0, v0, u1, v1 = k
        for j in range(int((u1 - u0) * W / 46)):
            if rng.random() < 0.35:
                uu = u0 + j * 46 / W
                panes.rect(uu, v0, min(u1, uu + 46 / W), v1)
        wash(img, panes.arr() * m, (214, 228, 236), dens=0.7, edge=0.2, seed=45 + i, wobble=0.05)

    # the warehouse: a pale roof with solar panels on the western half, the office in front
    roof = Mask().rect(*loods).arr()
    wash(img, roof, (222, 224, 226), dens=1.0, edge=0.55, bloom=0.3, seed=50, wobble=0.06)
    panels = Mask()
    for j in range(9):
        v = 0.226 + j * 0.03
        panels.rect(0.512, v, 0.64, v + 0.022)
    wash(img, panels.arr(), (104, 122, 150), dens=0.95, edge=0.4, bloom=0.2, seed=51, wobble=0.05)
    wash(img, Mask().rect(*office).arr(), (190, 180, 168), dens=1.0, edge=0.6, seed=52, wobble=0.06)

    # trucks: white trailers with coloured cabs, four at the docks, one coming in, one going out
    trucks_at = [0.561, 0.609, 0.681, 0.729]
    cabs = [(120, 168, 110), (220, 220, 220), (196, 92, 76), (98, 130, 176), (240, 196, 92), (120, 168, 110)]
    tl, tw, cl = 0.072, 0.0165, 0.017
    cab_mask = Mask()
    shade = Mask()
    trailers = Mask()
    for u in trucks_at:
        trailers.rect(u - tw * 0.5, 0.502, u + tw * 0.5, 0.5 + tl)
        cab_mask.rect(u - tw * 0.5, 0.5 + tl, u + tw * 0.5, 0.5 + tl + cl)
        shade.rect(u + tw * 0.15, 0.502, u + tw * 0.5, 0.5 + tl)
    # both on the road heading east, in the southern lane: one coming from the growers, one leaving for a customer
    road_trucks = [0.17, 0.78]
    for u in road_trucks:
        v = road_v(u) + 0.011
        cab_mask.rect(u + tl * 0.75, v - tw * 0.67, u + tl * 0.75 + cl * 0.75, v + tw * 0.67)
    cm = cab_mask.arr()
    # colour each cab separately
    lab, n = ndimage.label(cm > 0.5)
    for i in range(1, n + 1):
        wash(img, (lab == i).astype(F), cabs[(i - 1) % len(cabs)], dens=1.0, edge=0.5, seed=60 + i, wobble=0.04, bloom=0.2)
    for u in road_trucks:
        v = road_v(u) + 0.011
        trailers.rect(u, v - tw * 0.67, u + tl * 0.74, v + tw * 0.67)
    wash(img, trailers.arr(), (240, 240, 242), dens=1.0, edge=0.3, seed=58, wobble=0.03, bloom=0.1)
    wash(img, shade.arr(), (200, 204, 212), dens=0.8, seed=59, wobble=0.04)

    # trees: shadows first, then crowns in three alternating washes so neighbouring crowns keep their rims
    trees = []

    def row(u0, v0, u1, v1, n, rmin, rmax):
        for i in range(n):
            t = i / max(1, n - 1)
            trees.append((u0 + (u1 - u0) * t + rng.normal(0, 0.004), v0 + (v1 - v0) * t + rng.normal(0, 0.004), rng.uniform(rmin, rmax)))

    row(0.04, 0.615, 0.37, 0.615, 12, 15, 24)
    row(0.83, 0.6, 0.97, 0.6, 5, 15, 22)
    row(0.81, 0.36, 0.815, 0.56, 6, 14, 20)
    row(0.04, 0.03, 0.97, 0.04, 30, 16, 30)
    row(0.03, 0.06, 0.03, 0.95, 26, 16, 30)
    row(0.975, 0.06, 0.975, 0.95, 26, 16, 30)
    row(0.04, 0.975, 0.97, 0.972, 30, 16, 30)
    for _ in range(26):
        trees.append((rng.uniform(0.34, 0.45), rng.uniform(0.07, 0.36), rng.uniform(12, 22)))
    for _ in range(14):
        trees.append((rng.uniform(0.66, 0.8), rng.uniform(0.07, 0.17), rng.uniform(12, 20)))
    for _ in range(18):
        trees.append((rng.uniform(0.42, 0.62), rng.uniform(0.74, 0.95), rng.uniform(13, 24)))
    trees = [t for t in trees if not (0.47 < t[0] < 0.81 and 0.17 < t[1] < 0.64) and not any(k[0] < t[0] < k[2] and k[1] < t[1] < k[3] for k in kassen)]

    sh = Mask()
    for u, v, rr in trees:
        sh.circle(u + rr * 0.45 / W, v + rr * 0.5 / H, rr * 1.02)
    wash(img, sh.arr() * painted, (196, 200, 214), dens=0.85, edge=0.2, seed=70, wobble=0.1)
    groups = [Mask(), Mask(), Mask()]
    dark = np.zeros((H, W), F)
    for i, (u, v, rr) in enumerate(trees):
        groups[i % 3].circle(u, v, rr)
        x, y = P(u, v)
        x0, x1, y0, y1 = int(max(0, x - rr - 2)), int(min(W, x + rr + 3)), int(max(0, y - rr - 2)), int(min(H, y + rr + 3))
        gx, gy = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
        inside = np.hypot(gx - x, gy - y) <= rr
        lit = np.hypot(gx - (x - rr * 0.38), gy - (y - rr * 0.38)) <= rr * 0.85
        dark[y0:y1, x0:x1] = np.maximum(dark[y0:y1, x0:x1], (inside & ~lit).astype(F))
    greens = [(150, 186, 122), (134, 174, 112), (166, 192, 128)]
    for i, g in enumerate(groups):
        wash(img, g.arr() * painted, greens[i], dens=1.05, edge=0.75, bloom=0.35, seed=80 + i, dabs=0.5, wobble=0.25)
    wash(img, dark * painted, (150, 176, 128), dens=0.85, edge=0.3, bloom=0.3, seed=84, dabs=0.6, wobble=0.25)

    # ---------------------------------------------------------------- pen: buildings, docks, trucks, basins
    pen = Pen()
    pen.rect(*loods, width=2.2)
    pen.rect(*office, width=2.0)
    for j in range(1, 6):
        v = loods[1] + (loods[3] - loods[1]) * j / 6
        pen.line([(0.645, v), (loods[2], v)], 1.0, ink=150)
    for j in range(9):
        v = 0.226 + j * 0.03
        pen.rect(0.512, v, 0.64, v + 0.022, width=0.8, ink=170)
    for k in range(10):
        u = 0.53 + k * 0.024
        pen.rect(u, 0.495, u + 0.014, 0.505, width=1.0, fill=255)
    for u in trucks_at:
        pen.rect(u - tw * 0.5, 0.502, u + tw * 0.5, 0.5 + tl, width=1.4)
        pen.rect(u - tw * 0.5, 0.5 + tl + 0.002, u + tw * 0.5, 0.5 + tl + cl, width=1.4)
    for u in road_trucks:
        v = road_v(u) + 0.011
        pen.rect(u, v - tw * 0.67, u + tl * 0.74, v + tw * 0.67, width=1.4)
        pen.rect(u + tl * 0.76, v - tw * 0.67, u + tl * 0.75 + cl * 0.75, v + tw * 0.67, width=1.4)
    for k in kassen:
        pen.rect(*k, width=1.6, ink=200)
    for u, v, rr in basins:
        pen.circle(u, v, rr + 3, width=1.6, ink=200)
    # parked cars
    for k in range(7):
        u = 0.392 + k * 0.0108
        for v in (0.522, 0.57):
            if rng.random() < 0.72:
                col = [(196, 92, 76), (98, 130, 176), (230, 230, 230), (90, 96, 100), (240, 196, 92)][rng.integers(5)]
                m = Mask().rect(u, v, u + 0.0075, v + 0.026).arr()
                wash(img, m, col, dens=0.95, edge=0.4, seed=90 + k, wobble=0.03, bloom=0.1)
                pen.rect(u, v, u + 0.0075, v + 0.026, width=1.0, ink=200)
    pen.apply(img, (58, 60, 58))

    # fine ridges on the greenhouse roofs, in a light grey-blue
    ridge = Pen()
    for u0, v0, u1, v1 in kassen:
        n = int((u1 - u0) * W / 9)
        for j in range(1, n):
            u = u0 + j * 9 / W
            ridge.line([(u, v0 + 0.004), (u, v1 - 0.004)], 0.7, ink=120, wob=0.15)
    ridge.apply(img, (90, 118, 140))
    # crop rows in two of the fields
    rows = Pen()
    for (u0, v0, u1, v1) in (fields[1], fields[4]):
        for j in range(1, int((v1 - v0) * H / 12)):
            v = v0 + 0.012 + j * 12 / H
            if v < v1 - 0.006:
                rows.line([(u0 + 0.01, v), (u1 - 0.01, v)], 0.8, ink=110, wob=0.3)
    rows.apply(img, (110, 140, 90))

    out = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))
    out.save('/tmp/kaart-full.png')
    out.resize((1000, 750), Image.LANCZOS).save('/tmp/kaart-preview.png')
    # a square around the warehouse, the yard and the road: shown as a circle in the hero
    OUT.mkdir(parents=True, exist_ok=True)
    cx, cy, half = int(0.645 * W), int(0.43 * H), 500
    sq = out.crop((cx - half, cy - half, cx + half, cy + half))
    sq.resize((500, 500), Image.LANCZOS).save('/tmp/kaart-rond.png')
    for w in (480, 760, 1000):
        im = sq if w == 2 * half else sq.resize((w, w), Image.LANCZOS)
        im.save(OUT / f'kaart-{w}.webp', quality=82, method=6)
        im.save(OUT / f'kaart-{w}.avif', quality=62)
    print('kaart done')


if __name__ == '__main__':
    main()
