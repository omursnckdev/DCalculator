#!/usr/bin/env python3
"""
DXF kat planından AOS_DCalculator "plan JSON" (v2) üretir: duvarlar, elle belirlenmiş odalar ve **gerçek ekipman blokları**
(konum, boyut, dönüş, tür, etiket).

Kullanım:
  python3 scripts/dxf-plan.py plan.dxf examples/hdc02-gf.plan.json --odalar scripts/hdc02-gf.odalar.json [--ad "..."]

Gerekli: ezdxf (pip install ezdxf). DXF birimi mm varsayılır.

Varsayımlar (HDC02-ARP-DR-E-DD-MB-GF-POWR-1005 çiziminden):
  * Ekipman = E-ELEC-EQPM*, A-DETL-GENF*, A-DETL-GENF-7/-10 katmanlarındaki INSERT blokları (Revit ailesi); ayak izi bloğun
    (dönüşü uygulanmış) sınır kutusudur, yükseklik aile adındaki "…L x …W x …H"den (yoksa aile varsayılanı).
  * Etiket = E-ELE-QPM-IDEN katmanındaki MTEXT; ayak izine ≤ 0,35 m yakın en yakın etiket (bire bir, açgözlü eşleme).
  * Duvar = A-WALL-* / I-WALL-* katmanları (A-WALL-PATT tarama hariç), iç içe (xref) bloklar açılarak. Çizgiler eksene
    paralelse birleştirilir; 1,5 m'den küçük bağlantılı gruplar (kapı/pencere/doğrama parçaları) atılır.
  * Koordinatlar metre: x = (X + ORJ_X)/1000, z = (−Y + ORJ_Z)/1000; orijin, önceki PDF planıyla (aynı oda dosyası) çakışacak
    biçimde seçilmiştir (--orj-x/--orj-z ile değiştirilir).
  * Ekipman ön yüzü DXF'ten okunamaz; uygulama arkasına en yakın duvar yönünün tersini ön yüz seçer.
"""
import argparse
import json
import math
import re
import sys

import ezdxf
from ezdxf import bbox

ap = argparse.ArgumentParser()
ap.add_argument('dxf')
ap.add_argument('out')
ap.add_argument('--odalar', default='')
ap.add_argument('--ad', default='Kat planı (DXF)')
ap.add_argument('--orj-x', type=float, default=12076.0)
ap.add_argument('--orj-z', type=float, default=7940.0)
ap.add_argument('--etiket-mesafe', type=float, default=700.0, help='etiket–ayak izi en büyük mesafesi (mm)')
ap.add_argument('--kucuk-bilesen', type=float, default=1.5)
a = ap.parse_args()

doc = ezdxf.readfile(a.dxf)
msp = doc.modelspace()


def m(x, y):
    return ((x + a.orj_x) / 1000.0, (-y + a.orj_z) / 1000.0)


# --- ekipman ----------------------------------------------------------------------------------------------------
EQ_LAYERS = {'E-ELEC-EQPM', 'E-ELEC-EQPM-2', 'A-DETL-GENF', 'A-DETL-GENF-1', 'A-DETL-GENF-7', 'A-DETL-GENF-10'}
# (regex, tür, aile adı, varsayılan yükseklik mm)
FAMILIES = [
    (r'Battery Cabinet', 'batarya', 'Batarya dolabı', 2000),
    (r'Load Bank', 'yukBankasi', 'Load bank', 1500),
    (r'Battery Control Panel', 'bcp', 'Batarya kontrol paneli', 1800),
    (r'DC Power Panel', 'dcPanel', 'DC güç panosu', 2200),
    (r'Transformer_Dry', 'trafo', 'Kuru tip trafo', 2900),
    (r'Medium Voltage.*MVTB', 'rmu', 'RMU / OG pano', 1800),
    (r'Main Switchboard', 'mdb', 'Ana dağıtım panosu', 2200),
    (r'STS Switchboard', 'bara', 'STS bara panosu', 2200),
    (r'Transfer Switch_Static', 'sts', 'STS', 2200),
    (r'UDP_Type', 'mdb', 'UPS dağıtım panosu', 2200),
    (r'LBSB', 'mdb', 'LBSB', 2200),
    (r'Uninterruptible Power Supply', 'ups', 'UPS', 2200),
    (r'RPP_Type', 'rpp', 'RPP', 800),
    (r'(DB|BTU)_Type', 'dagitimPanosu', 'Dağıtım panosu', 800),
    (r'Telecommunications Rack', 'telekomDolap', 'Telekom dolabı', 2200),
]


def family(name):
    for rx, tur, ad, h in FAMILIES:
        if re.search(rx, name):
            return tur, ad, h
    return None


def dims_mm(name):
    mt = re.search(r'(\d+)L x (\d+)W x (\d+)H', name)
    return (int(mt.group(1)), int(mt.group(2)), int(mt.group(3))) if mt else None


def hints(name, tur):
    """Adın içindeki anma değerleri: UPS kW, trafo kVA, pano akımı."""
    p = {}
    mt = re.search(r'_(\d+)\s*KW', name, re.I)
    if tur == 'ups' and mt:
        p['nominalKw'] = int(mt.group(1))
    mt = re.search(r'Type 1_(\d+)_(\d+)MVA', name)
    if tur == 'trafo' and mt:
        p['nominalKva'] = int(mt.group(1)) * 1000 + int(mt.group(2)) * 10
    mt = re.search(r'(\d+)\s?A\b', name)
    if tur in ('mdb', 'sts') and mt:
        p['nominalAkim'] = int(mt.group(1))
    return p


objs = []
for e in msp:
    if e.dxftype() != 'INSERT' or e.dxf.layer not in EQ_LAYERS:
        continue
    name = re.sub(r'-\w*-70-E-GF-1-1-10$', '', e.dxf.name)
    fam = family(name)
    if not fam:
        continue
    try:
        bb = bbox.extents(e.virtual_entities())
    except Exception:
        continue
    if not bb.has_data:
        continue
    tur, aile, hdef = fam
    dm = dims_mm(name)
    h = dm[2] if dm else hdef
    objs.append({'tur': tur, 'aile': aile, 'blok': name, 'bx': bb.center.x, 'by': bb.center.y, 'w': bb.size.x, 'd': bb.size.y, 'h': h, 'rot': e.dxf.rotation, 'p': hints(name, tur)})

# --- etiketler -------------------------------------------------------------------------------------------------------
texts = []
for e in msp:
    if e.dxftype() == 'MTEXT' and e.dxf.layer == 'E-ELE-QPM-IDEN':
        t = re.sub(r'\\[A-Za-z][^;]*;', '', e.text).replace('\\P', ' ').replace('{', '').replace('}', '').strip().rstrip('/ ')
        if t:
            texts.append({'t': t, 'x': e.dxf.insert.x, 'y': e.dxf.insert.y, 'used': False})


def rect_dist(o, x, y):
    dx = max(abs(x - o['bx']) - o['w'] / 2, 0)
    dy = max(abs(y - o['by']) - o['d'] / 2, 0)
    return math.hypot(dx, dy)


CALLOUT = re.compile(r'^(PMS|DB\.|UDB\.|ACD\.|CBL)')


def score(o, t):
    d = rect_dist(o, t['x'], t['y'])
    # Büyük ekipmanın (≥ 1,5 m) üzerine düşen küçük pano çağrı metinleri (PMS/..., UDB.…) ekipmanın kendi etiketi değildir
    if CALLOUT.match(t['t']) and max(o['w'], o['d']) >= 1500:
        d += 2000
    return d


pairs = sorted(((score(o, t), i, j) for i, o in enumerate(objs) for j, t in enumerate(texts)), key=lambda p: p[0])
for dist, i, j in pairs:
    if dist > a.etiket_mesafe:
        break
    if 'etiket' in objs[i] or texts[j]['used']:
        continue
    objs[i]['etiket'] = texts[j]['t']
    texts[j]['used'] = True

# 2. geçiş: kutudan uzakta, aynı hizada (yatay çağrı çizgisiyle bağlı) pano çağrı metinleri (ör. "PMS/UDP.PL1.1", "DB.PL1.1/")
SECOND = {'dagitimPanosu': CALLOUT, 'bcp': re.compile(r'^BCP'), 'dcPanel': re.compile(r'^(DCP|DCD)')}
for o in objs:
    if 'etiket' in o or o['tur'] not in SECOND:
        continue
    best = None
    for t in texts:
        if t['used'] or not SECOND[o['tur']].match(t['t']):
            continue
        dy = abs(t['y'] - o['by'])
        dx = abs(t['x'] - o['bx'])
        if dy <= 350 and dx <= 9000 and (best is None or (dy, dx) < best[0]):
            best = ((dy, dx), t)
    if best:
        o['etiket'] = best[1]['t']
        best[1]['used'] = True

ekipman = []
auto = {}
for o in sorted(objs, key=lambda o: (o['bx'], o['by'])):
    cx, cz = m(o['bx'], o['by'])
    et = o.get('etiket')
    if not et:
        auto[o['aile']] = auto.get(o['aile'], 0) + 1
        et = f"{o['aile']} {auto[o['aile']]}"
        o['etiketsiz'] = True
    ekipman.append({'etiket': et, 'tur': o['tur'], 'aile': o['aile'], 'x': round(cx, 3), 'z': round(cz, 3), 'g': round(o['w'] / 1000, 3), 'd': round(o['d'] / 1000, 3), 'h': round(o['h'] / 1000, 3), 'blok': o['blok'], **({'p': o['p']} if o['p'] else {}), **({'etiketsiz': True} if o.get('etiketsiz') else {})})

# --- duvarlar --------------------------------------------------------------------------------------------------------
raw = []


def walk(ents, depth):
    for e in ents:
        t, L = e.dxftype(), e.dxf.layer
        if t == 'INSERT':
            if depth < 3 and not L.startswith(('A-DOOR', 'A-GLAZ', 'I-FURN', 'Q-', 'A-GENM', 'A-FLOR-HRAL', 'S-COLS', 'C-', 'L-')):
                try:
                    walk(e.virtual_entities(), depth + 1)
                except Exception:
                    pass
        elif t == 'LINE' and L.startswith(('A-WALL', 'I-WALL')) and 'PATT' not in L:
            s, en = e.dxf.start, e.dxf.end
            raw.append((s.x, s.y, en.x, en.y))


for e in msp:
    if e.dxftype() == 'INSERT' and e.dxf.layer == '0-1':
        walk(e.virtual_entities(), 0)
if not raw:
    sys.exit('duvar bulunamadı')


def snap(v):
    return round(v / 0.02) * 0.02


segs = set()
for x0, y0, x1, y1 in raw:
    (ax, az), (bx, bz) = m(x0, y0), m(x1, y1)
    t = (round(snap(ax), 2), round(snap(az), 2), round(snap(bx), 2), round(snap(bz), 2))
    if t[0] == t[2] and t[1] == t[3]:
        continue
    if (t[0], t[1]) > (t[2], t[3]):
        t = (t[2], t[3], t[0], t[1])
    segs.add(t)


def merge_axis(ws):
    horiz, vert, other = {}, {}, []
    for x0, z0, x1, z1 in ws:
        if z0 == z1:
            horiz.setdefault(z0, []).append((min(x0, x1), max(x0, x1)))
        elif x0 == x1:
            vert.setdefault(x0, []).append((min(z0, z1), max(z0, z1)))
        else:
            other.append((x0, z0, x1, z1))
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


def drop_small(ws, min_extent):
    n = len(ws)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = {}
    for i, (x0, z0, x1, z1) in enumerate(ws):
        L = max(abs(x1 - x0), abs(z1 - z0))
        k = max(1, int(L / 0.2))
        for j in range(k + 1):
            px, pz = x0 + (x1 - x0) * j / k, z0 + (z1 - z0) * j / k
            cx, cz = int(px / 0.2), int(pz / 0.2)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    o = cell.get((cx + dx, cz + dz))
                    if o is not None and o != i:
                        parent[find(i)] = find(o)
            cell[(cx, cz)] = i
    comp = {}
    for i, (x0, z0, x1, z1) in enumerate(ws):
        c = comp.setdefault(find(i), [1e9, 1e9, -1e9, -1e9, []])
        c[0], c[1] = min(c[0], x0, x1), min(c[1], z0, z1)
        c[2], c[3] = max(c[2], x0, x1), max(c[3], z0, z1)
        c[4].append(i)
    keep = []
    for c in comp.values():
        if max(c[2] - c[0], c[3] - c[1]) >= min_extent:
            keep.extend(c[4])
    return [ws[i] for i in sorted(keep)]


walls = drop_small(merge_axis(sorted(segs)), a.kucuk_bilesen)
all_x = [v for w in walls for v in (w[0], w[2])] + [e['x'] for e in ekipman]
all_z = [v for w in walls for v in (w[1], w[3])] + [e['z'] for e in ekipman]
# Binanın dışındaki uzak çizgiler (arazi, yol) sınır kutusunu şişirmesin: ekipman çevresi + 25 m
ex0, ex1 = min(e['x'] for e in ekipman) - 70, max(e['x'] for e in ekipman) + 40
ez0, ez1 = min(e['z'] for e in ekipman) - 25, max(e['z'] for e in ekipman) + 25
walls = [w for w in walls if ex0 <= min(w[0], w[2]) and max(w[0], w[2]) <= ex1 and ez0 <= min(w[1], w[3]) and max(w[1], w[3]) <= ez1]

rooms = json.load(open(a.odalar, encoding='utf-8')) if a.odalar else []
W = max([max(w[0], w[2]) for w in walls] + [1])
D = max([max(w[1], w[3]) for w in walls] + [1])
res = {
    'surum': 2,
    'ad': a.ad,
    'kaynak': a.dxf.split('/')[-1],
    'birim': 'm',
    'sinir': {'g': round(W, 2), 'd': round(D, 2)},
    'duvarlar': [[round(v, 2) for v in w] for w in walls],
    'odalar': rooms,
    'ekipman': ekipman,
}
with open(a.out, 'w', encoding='utf-8') as f:
    json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
by = {}
for e in ekipman:
    by[e['tur']] = by.get(e['tur'], 0) + 1
print(f'duvar {len(walls)} · oda {len(rooms)} · ekipman {len(ekipman)} {by} · etiketsiz {sum(1 for e in ekipman if e.get("etiketsiz"))} · sınır {W:.1f}×{D:.1f} m → {a.out}')
