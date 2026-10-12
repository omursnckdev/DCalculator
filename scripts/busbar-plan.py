#!/usr/bin/env python3
"""
Busbar dağıtım planı DXF'inden (HDC02-ARP-DR-E-DD-MB-GF-POWR-1016) bara güzergâhı parçalarını çıkarıp plan JSON'una `baralar` olarak ekler.

Kullanım:
  python3 scripts/busbar-plan.py busbar.dxf examples/hdc02-gf.plan.json [--kontrol]

Gerekli: ezdxf, shapely (pip install ezdxf shapely).

Çizimin yapısı:
  * Bara düz kısımları M-HVAC-DUCT katmanında düz çizgi çiftleri (Revit "duct" olarak modellenmiş); dirsek/te/geçiş parçaları ise
    "…Elbow_Square - E-<Aile>_Busbar" adlı INSERT bloklarıdır (aile: Tx, Gen, Power_Lineup, Catcher, Load Bank, Chiller, Data Hall).
    Çizgiler shapely ile kapalı dikdörtgenlere çevrilir; her parça eksene paralel sınır kutusu (merkez x, z, genişlik g, derinlik d, m).
  * Bu çizimin orijini zemin kat planından 37 054 mm doğuya kaymıştır (ekipman konumları bire bir çakışır: 243 bloktan 0'ı kayık);
    bu yüzden x = (X + 12076 − 37054) / 1000, z = (−Y + 7940) / 1000.
  * Plan görünümünde yükseklik yoktur: farklı kotlardaki baralar üst üste biner. Bu yüzden parçaların bağlantı topolojisi
    (hangi hat hangi baradır) çizimden güvenilir çıkarılamaz; parçalar görsel referans olarak (kabaca bara koridorları) eklenir.
    `t`: 'duz' (düz bara) veya aile (dirsek/te: tx, gen, hat, yakalayici, yukbankasi, chiller, salon); 'tap' tap-off/konnektör kutusu.
"""
import argparse
import json
import re
import sys

import ezdxf
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

ap = argparse.ArgumentParser()
ap.add_argument('dxf')
ap.add_argument('plan')
ap.add_argument('--orj-x', type=float, default=12076.0 - 37054.0)
ap.add_argument('--orj-z', type=float, default=7940.0)
ap.add_argument('--kontrol', action='store_true', help='yalnız say, dosyayı yazma')
a = ap.parse_args()

doc = ezdxf.readfile(a.dxf)
msp = doc.modelspace()


def m(x, y):
    return ((x + a.orj_x) / 1000.0, (-y + a.orj_z) / 1000.0)


def seg(e):
    p, q = m(e.dxf.start.x, e.dxf.start.y), m(e.dxf.end.x, e.dxf.end.y)
    return None if p == q else (p, q)


def polys(segs):
    return [p for p in polygonize(unary_union([LineString(s) for s in segs])) if p.area > 1e-4]


FAM = re.compile(r'E-(Tx|Gen|Power_Lineup|Catcher|Load Bank|Chiller|Data Hall)_Busbar')
KOD = {'Tx': 'tx', 'Gen': 'gen', 'Power_Lineup': 'hat', 'Catcher': 'yakalayici', 'Load Bank': 'yukbankasi', 'Chiller': 'chiller', 'Data Hall': 'salon'}
free = []
fit = []
tap = []
for e in msp:
    t = e.dxftype()
    if t == 'LINE' and e.dxf.layer == 'M-HVAC-DUCT':
        s = seg(e)
        if s:
            free.append(s)
    elif t == 'INSERT' and 'Busbar' in e.dxf.name:
        mm = FAM.search(e.dxf.name)
        segs = [s for x in e.virtual_entities() if x.dxftype() == 'LINE' and x.dxf.layer in ('M-HVAC-DUCT', 'A-DETL-HDLN-3') for s in [seg(x)] if s]
        if mm:
            fit.append((KOD[mm.group(1)], segs))
        elif segs:
            tap.append(segs)

out = []


def add(t, p):
    x0, z0, x1, z1 = p.bounds
    g, d = x1 - x0, z1 - z0
    if max(g, d) < 0.05:
        return
    out.append({'t': t, 'x': round((x0 + x1) / 2, 2), 'z': round((z0 + z1) / 2, 2), 'g': round(g, 2), 'd': round(d, 2)})


for p in polys(free):
    add('duz', p)
for fam, segs in fit:
    for p in polys(segs):
        add(fam, p)
for segs in tap:
    for p in polys(segs):
        add('tap', p)
# aynı kutuyu iki kez ekleme (düz çizgiyle fitting çizgisi örtüşebilir)
uniq = {}
for b in out:
    uniq.setdefault((b['x'], b['z'], b['g'], b['d']), b)
out = list(uniq.values())
by = {}
for b in out:
    by[b['t']] = by.get(b['t'], 0) + 1
print(f'{len(out)} bara parçası: {by}', file=sys.stderr)
if not a.kontrol:
    plan = json.load(open(a.plan, encoding='utf-8'))
    plan['baralar'] = out
    plan['baraKaynak'] = a.dxf.split('/')[-1].split('-', 1)[-1][:120]
    with open(a.plan, 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, separators=(',', ':'))
    print('→', a.plan)
