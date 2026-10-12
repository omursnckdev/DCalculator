#!/usr/bin/env python3
"""
Plan JSON oda denetimi: her oda için dört kenarın duvarla örtülme oranı, kapı boşlukları ve oda içinden geçen bölücü duvarlar.
Kullanım: python3 scripts/plan-kontrol.py plan.json [--bindir pdf cikti.png]
Kenarda 3,2 m'den geniş boşluk veya odayı baştan başa kesen duvar varsa oda büyük olasılıkla yanlış çizilmiştir.
"""
import json
import sys

p = json.load(open(sys.argv[1], encoding='utf-8'))
W = [w for w in p['duvarlar'] if max(abs(w[2] - w[0]), abs(w[3] - w[1])) >= 1.0]
TOL = 0.45


def side_cover(horiz, fixed, a0, a1):
    iv = []
    for x0, z0, x1, z1 in W:
        if horiz and abs(z0 - z1) < 0.06 and abs(z0 - fixed) <= TOL:
            iv.append((min(x0, x1), max(x0, x1)))
        if (not horiz) and abs(x0 - x1) < 0.06 and abs(x0 - fixed) <= TOL:
            iv.append((min(z0, z1), max(z0, z1)))
    iv.sort()
    cur, gaps = a0, []
    for s, e in iv:
        if e < cur or s > a1:
            continue
        if s > cur:
            gaps.append((cur, s))
        cur = max(cur, e)
    if cur < a1:
        gaps.append((cur, a1))
    gaps = [(round(a, 1), round(b, 1)) for a, b in gaps if b - a >= 0.3]
    return 1 - sum(b - a for a, b in gaps) / (a1 - a0), gaps


def outline_of_equipment(w):
    """Çizgi ekipman dikdörtgenlerinin (yan yana dizili olabilir) kenarlarını izliyorsa dolap dış hattıdır, bölücü duvar sayılmaz."""
    x0, z0, x1, z1 = w
    L = max(abs(x1 - x0), abs(z1 - z0))
    n = max(2, int(L / 0.3))
    for k in range(n + 1):
        px, pz = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
        ok = False
        for e in p['ekipman']:
            ex0, ex1, ez0, ez1 = e['x'] - e['g'] / 2 - 0.2, e['x'] + e['g'] / 2 + 0.2, e['z'] - e['d'] / 2 - 0.2, e['z'] + e['d'] / 2 + 0.2
            if ex0 <= px <= ex1 and ez0 <= pz <= ez1:
                ok = True
                break
        if not ok:
            return False
    return True


def partitions(r):
    out = []
    x, z, g, d = r['x'], r['z'], r['g'], r['d']
    for w in W:
        x0, z0, x1, z1 = w
        if outline_of_equipment(w):
            continue
        if abs(z0 - z1) < 0.06 and z + 0.5 < z0 < z + d - 0.5:
            L = min(max(x0, x1), x + g) - max(min(x0, x1), x)
            if L >= 0.85 * g:
                out.append(f'yatay duvar z={z0:.1f} ({L:.1f} m)')
        if abs(x0 - x1) < 0.06 and x + 0.5 < x0 < x + g - 0.5:
            L = min(max(z0, z1), z + d) - max(min(z0, z1), z)
            if L >= 0.85 * d:
                out.append(f'dikey duvar x={x0:.1f} ({L:.1f} m)')
    return sorted(set(out))


bad = 0
for i, r in enumerate(p['odalar'], 1):
    x, z, g, d = r['x'], r['z'], r['g'], r['d']
    res = []
    low = False
    for name, horiz, fixed, a0, a1 in (('kuzey', True, z, x, x + g), ('güney', True, z + d, x, x + g), ('batı', False, x, z, z + d), ('doğu', False, x + g, z, z + d)):
        c, gaps = side_cover(horiz, fixed, a0, a1)
        # 3,2 m'ye kadar boşluklar kapı/açıklık sayılır; daha geniş boşluk (açık kenar) kontrol gerektirir
        low |= any(b - a > 3.2 for a, b in gaps)
        res.append(f"{name} %{c * 100:.0f}" + (f" kapı/boşluk {gaps}" if gaps else ''))
    part = partitions(r)
    eq = sum(1 for e in p['ekipman'] if x <= e['x'] <= x + g and z <= e['z'] <= z + d)
    flag = 'KONTROL' if (low or part) else 'tamam'
    bad += flag != 'tamam'
    print(f"{i:2d} {r['ad']:<28} {g:5.1f}×{d:5.1f} m ekipman {eq:2d} [{flag}] " + ' | '.join(res) + (f"  İÇ DUVAR: {part}" if part else ''))
print(f"{len(p['odalar'])} oda, {bad} kontrol gerektiriyor")
