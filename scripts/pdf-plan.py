#!/usr/bin/env python3
"""
Vektör PDF kat planından AOS_DCalculator "plan JSON" dosyası üretir (duvarlar, odalar, ekipman dikdörtgenleri).

Kullanım:
  python3 scripts/pdf-plan.py plan.pdf examples/hdc02-gf.plan.json [--olcek 100] [--kagit-mm-pt 0.3528]
        [--kirp x0,y0,x1,y1] [--duvar-kalinlik 1.3] [--ad "HDC02 zemin kat"]

Gerekli: pdfplumber (pip install pdfplumber); --debug için Pillow.

Varsayımlar (HDC02-ARP-DR-E-DD-MB-GF-POWR-1005 çiziminden):
  * PDF birimi 1 pt = 0,3528 mm kâğıt; ölçek 1:100 → 1 pt = 0,03528 m. (--olcek ile değişir)
  * Duvarlar: çizgi kalınlığı ≥ 1,3 pt, gri/siyah. Çizimdeki ince çizgiler (mobilya, tarama) alınmaz.
  * Ekipman: sarı (1,0,0,92,0) veya krem dolgulu dikdörtgen, içindeki metin ekipman etiketidir (ör. MSB.PL1).
  * Oda: duvar koordinatlarına bakılarak elle yazılan --odalar dosyasından alınır (otomatik tespit güvenilmez).
  * y ekseni aşağı yönlü olduğundan plan y'si doğrudan uygulamanın z eksenidir (kuzey = −z).
Çıktı koordinatları metre, bina sınır kutusunun sol-üst köşesi (0, 0).
"""
import argparse
import json
import re
import sys
from collections import deque

import pdfplumber

ap = argparse.ArgumentParser()
ap.add_argument('pdf')
ap.add_argument('out')
ap.add_argument('--olcek', type=float, default=100.0)
ap.add_argument('--kagit-mm-pt', type=float, default=0.3528)
ap.add_argument('--kirp', default='480,250,3800,2150', help='çizim alanı (pt): x0,y0,x1,y1')
ap.add_argument('--duvar-kalinlik', type=float, default=1.3)
ap.add_argument('--ad', default='Kat planı')
ap.add_argument('--debug', default='', help='kontrol görüntüsü (PNG) yolu')
ap.add_argument('--kucuk-bilesen', type=float, default=3.5, help='bu boyuttan küçük bağlantılı çizim grupları (dolap, mobilya) duvar sayılmaz (m)')
ap.add_argument('--odalar', default='', help='elle belirlenen oda listesi (JSON)')
a = ap.parse_args()

S = a.kagit_mm_pt * a.olcek / 1000.0  # m / pt
cx0, cy0, cx1, cy1 = [float(v) for v in a.kirp.split(',')]


def col(c):
    return tuple(round(x, 2) for x in c) if isinstance(c, (list, tuple)) else c


def inside(x, y):
    return cx0 <= x <= cx1 and cy0 <= y <= cy1


pdf = pdfplumber.open(a.pdf)
page = pdf.pages[0]

# --- duvarlar ---------------------------------------------------------------------------------------------------
WALL_COLORS = {(0.64, 0.64, 0.64), (0.54, 0.54, 0.54), (0.0, 0.0, 0.0)}
raw = []
for l in page.lines:
    if l['linewidth'] < a.duvar_kalinlik or col(l.get('stroking_color')) not in WALL_COLORS:
        continue
    if not (inside(l['x0'], l['top']) and inside(l['x1'], l['bottom'])):
        continue
    raw.append((l['x0'], l['top'], l['x1'], l['bottom']))
if not raw:
    sys.exit('duvar çizgisi bulunamadı (--duvar-kalinlik / --kirp değerlerini deneyin)')
ox = min(min(r[0], r[2]) for r in raw)
oy = min(min(r[1], r[3]) for r in raw)


def m(x, y):
    return ((x - ox) * S, (y - oy) * S)


def snap(v):
    return round(v / 0.02) * 0.02


segs = set()
for x0, y0, x1, y1 in raw:
    (ax, ay), (bx, by) = m(x0, y0), m(x1, y1)
    t = (round(snap(ax), 2), round(snap(ay), 2), round(snap(bx), 2), round(snap(by), 2))
    if t[0] == t[2] and t[1] == t[3]:
        continue
    if (t[0], t[1]) > (t[2], t[3]):
        t = (t[2], t[3], t[0], t[1])
    segs.add(t)
walls = sorted(segs)

# Eksene paralel, aynı doğru üzerinde ve bitişik/çakışan parçaları birleştir.
def merge_axis(ws):
    horiz, vert, other = {}, {}, []
    for x0, y0, x1, y1 in ws:
        if y0 == y1:
            horiz.setdefault(y0, []).append((min(x0, x1), max(x0, x1)))
        elif x0 == x1:
            vert.setdefault(x0, []).append((min(y0, y1), max(y0, y1)))
        else:
            other.append((x0, y0, x1, y1))
    out = []
    for k, iv in horiz.items():
        iv.sort()
        cur = list(iv[0])
        for s, e in iv[1:]:
            if s <= cur[1] + 0.05:
                cur[1] = max(cur[1], e)
            else:
                out.append((cur[0], k, cur[1], k)); cur = [s, e]
        out.append((cur[0], k, cur[1], k))
    for k, iv in vert.items():
        iv.sort()
        cur = list(iv[0])
        for s, e in iv[1:]:
            if s <= cur[1] + 0.05:
                cur[1] = max(cur[1], e)
            else:
                out.append((k, cur[0], k, cur[1])); cur = [s, e]
        out.append((k, cur[0], k, cur[1]))
    return out + other


walls = merge_axis(walls)


def drop_small_components(ws, min_extent):
    """Birbirine değen duvar çizgilerini bileşenlere ayırır; sınır kutusu min_extent'ten küçük bileşenler (dolap, mobilya, kolon dış hatları) atılır."""
    n = len(ws)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = {}
    for i, (x0, y0, x1, y1) in enumerate(ws):
        L = max(abs(x1 - x0), abs(y1 - y0))
        k = max(1, int(L / 0.2))
        for j in range(k + 1):
            px, py = x0 + (x1 - x0) * j / k, y0 + (y1 - y0) * j / k
            cx, cy = int(px / 0.2), int(py / 0.2)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    o = cell.get((cx + dx, cy + dy))
                    if o is not None and o != i:
                        parent[find(i)] = find(o)
            cell[(cx, cy)] = i
    comp = {}
    for i, (x0, y0, x1, y1) in enumerate(ws):
        c = comp.setdefault(find(i), [1e9, 1e9, -1e9, -1e9, []])
        c[0], c[1] = min(c[0], x0, x1), min(c[1], y0, y1)
        c[2], c[3] = max(c[2], x0, x1), max(c[3], y0, y1)
        c[4].append(i)
    keep = []
    for c in comp.values():
        if max(c[2] - c[0], c[3] - c[1]) >= min_extent:
            keep.extend(c[4])
    return [ws[i] for i in sorted(keep)]


_before = len(walls)
walls = drop_small_components(walls, a.kucuk_bilesen)
print(f'küçük bileşenler atıldı: {_before - len(walls)} çizgi', file=sys.stderr)
W = max(max(w[0], w[2]) for w in walls)
D = max(max(w[1], w[3]) for w in walls)

# --- ekipman dikdörtgenleri ----------------------------------------------------------------------------------------
words = page.extract_words(extra_attrs=['upright'])
cands = []  # (metin, x_merkez_pt, y_merkez_pt)
for w in words:
    t = w['text']
    cands.append((t, (w['x0'] + w['x1']) / 2, (w['top'] + w['bottom']) / 2))
    if not w['upright']:
        cands.append((t[::-1], (w['x0'] + w['x1']) / 2, (w['top'] + w['bottom']) / 2))  # yukarı okunan metin ters gelir
TAG = re.compile(r'^[A-Z]{2,6}(?:[./-][A-Z0-9]+)+$')
FILLS = {(1.0, 0.92, 0.0), (1.0, 0.99, 0.91)}
equip = []
for r in page.rects:
    if col(r.get('non_stroking_color')) not in FILLS:
        continue
    w_m, h_m = r['width'] * S, r['height'] * S
    if w_m < 0.5 or h_m < 0.5 or w_m > 30 or h_m > 30 or not inside(r['x0'], r['top']):
        continue
    inner = [t for t, x, y in cands if r['x0'] - 1 <= x <= r['x1'] + 1 and r['top'] - 1 <= y <= r['bottom'] + 1 and TAG.match(t)]
    if not inner:
        continue
    # birden çok aday: en uzun (en belirgin) olan
    tag = max(inner, key=len)
    cxm, czm = m((r['x0'] + r['x1']) / 2, (r['top'] + r['bottom']) / 2)
    equip.append({'etiket': tag, 'x': round(cxm, 2), 'z': round(czm, 2), 'g': round(w_m, 2), 'd': round(h_m, 2)})
# Aynı etiket birden çok dikdörtgense (ör. şerit çizimi) en büyüğü kalır.
best = {}
for e in equip:
    k = e['etiket']
    if k not in best or e['g'] * e['d'] > best[k]['g'] * best[k]['d']:
        best[k] = e
equip = sorted(best.values(), key=lambda e: e['etiket'])

# --- odalar --------------------------------------------------------------------------------------------------------
# Oda sınırları duvar çizgilerinden otomatik çıkarılamadı (kapı boşlukları ve dolap dış hatları nedeniyle taşma), bu yüzden
# duvar koordinatlarına bakılarak elle belirlenir: --odalar dosyası [{ad, tur, x, z, g, d, y}] (metre, bina köşesi 0,0).
rooms = []
if a.odalar:
    with open(a.odalar, encoding='utf-8') as f:
        rooms = json.load(f)

res = {
    'surum': 1,
    'ad': a.ad,
    'kaynak': a.pdf.split('/')[-1],
    'olcek': a.olcek,
    'sinir': {'g': round(W, 2), 'd': round(D, 2)},
    'duvarlar': [[round(v, 2) for v in w] for w in walls],
    'odalar': rooms,
    'ekipman': equip,
}
if a.debug:
    from PIL import Image, ImageDraw
    k = 8
    im = Image.new('RGB', (int(W * k) + 10, int(D * k) + 10), 'white'); d = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in walls:
        d.line([(x0 * k, y0 * k), (x1 * k, y1 * k)], fill=(120, 120, 120), width=1)
    for r in rooms:
        d.rectangle([r['x'] * k, r['z'] * k, (r['x'] + r['g']) * k, (r['z'] + r['d']) * k], outline=(220, 0, 0), width=2)
        d.text((r['x'] * k + 3, r['z'] * k + 3), r['ad'], fill=(220, 0, 0))
    for e in equip:
        d.rectangle([(e['x'] - e['g'] / 2) * k, (e['z'] - e['d'] / 2) * k, (e['x'] + e['g'] / 2) * k, (e['z'] + e['d'] / 2) * k], outline=(0, 0, 200))
    im.save(a.debug)
with open(a.out, 'w', encoding='utf-8') as f:
    json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
print(f'duvar {len(walls)} · oda {len(rooms)} · ekipman {len(equip)} · sınır {W:.1f}×{D:.1f} m → {a.out}')
