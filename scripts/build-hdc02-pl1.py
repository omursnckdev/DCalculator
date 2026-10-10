#!/usr/bin/env python3
"""
HDC02-ARP-SC-E-DD-ZZ-ZZ-POWR-6002 "LV Distribution Schematic Power Line-up 1" şemasından
DCalculator proje dosyası (examples/hdc02-pl1.dcalc.json) üretir.

Topoloji ve değerler DXF'ten okundu (etiketler, akım değerleri, UPS/trafo/jeneratör etiketleri,
kablo ve bara adları, blok konumları). Şemada OLMAYAN değerler (yük kW'ları, kablo uzunlukları,
trafo kayıpları, jeneratör kVA, UPS verimi) VARSAYIMDIR; ilgili düğümlerin 'notlar' alanında
"Varsayım:" ile işaretlenmiştir. Çalıştırma: python3 scripts/build-hdc02-pl1.py
"""
import json, math, os

V = 415  # şemadaki LV gerilimi (TX.PL1: 34.5 kV / 415 V)
SX, SY = 0.05, 0.035  # ikon görünümüne göre sıkı yerleşim
def X(x): return x * SX
def Y(y): return (y + 16000) * SY

nodes, edges = {}, []

def p3(i, pf): return math.sqrt(3) * V * i * pf / 1000.0

# ---------------------------------------------------------------- düğüm üreticileri
def add(id, type, ad, pos, params, etiket='', notlar='', grup=''):
    nodes[id] = dict(id=id, type=type, ad=ad, etiket=etiket, grup=grup, notlar=notlar,
                     x=round(pos[0]), y=round(pos[1]), params=params)
    return id

def breaker(id, ad, tip, amp, kutup, dxf, durum='kapali', etiket='', notlar='', grup=''):
    return add(id, 'kesici', ad, (X(dxf[0]), Y(dxf[1])),
               dict(tip=tip, nominalAkim=amp, kutup=kutup, durum=durum, otomatik='yok', gerilim=V), etiket, notlar, grup)

def bus(id, ad, amp, dxf, tip='mdb', etiket='', notlar='', grup=''):
    return add(id, tip, ad, (X(dxf[0]), Y(dxf[1])), dict(gerilim=V, nominalAkim=amp, diversity=1), etiket, notlar, grup)

def load(id, ad, kw, dxf, kategori='Mekanik', pf=0.9, df=1, isi='dis', etiket='', notlar='', typ=None, grup=''):
    typ = typ or ('itYuku' if kategori == 'IT' else 'mekanikYuk')
    return add(id, typ, ad, (X(dxf[0]), Y(dxf[1])),
               dict(kuruluKw=kw, pf=pf, df=df, kategori=kategori, gerilim=V, isiKonum=isi), etiket, notlar, grup)

def helper(id, ad, alt, dxf, etiket='', notlar='', grup=''):
    return add(id, 'yardimci', ad, (X(dxf[0]), Y(dxf[1])), dict(altTip=alt, gerilim=V), etiket, notlar, grup)

def edge(s, t, ad='', aciklama='', kind='busbar', cap=None, length=None, pay=None, durum='kapali', gerilim=V, r=None, x=None):
    if kind == 'busbar':
        r = 0.02 if r is None else r; x = 0.02 if x is None else x; length = 8 if length is None else length
    else:
        r = 0.1 if r is None else r; x = 0.08 if x is None else x; length = 40 if length is None else length
    edges.append(dict(id=f'e{len(edges)+1:03d}', source=s, target=t, tip=kind if kind != 'kablo' else 'kablo',
                      uzunluk=length, akimKapasitesi=cap or 100000, r=r, x=x, gerilim=gerilim, pay=pay,
                      isiKonum='elektrik', durum=durum, ad=ad, aciklama=aciklama))

# Kablo kesitine göre yaklaşık Cu XLPE akım taşıma (IEC 60364-5-52, açık tava) ve R/X (Ω/km)
CABLE = {  # kesit(mm²): (A, R, X)
    16: (99, 1.15, 0.09), 35: (158, 0.524, 0.085), 50: (192, 0.387, 0.083),
    70: (246, 0.268, 0.082), 95: (298, 0.193, 0.081), 120: (346, 0.153, 0.080),
}
def cable(s, t, ad, spec, parallel, mm2, length=40, **kw):
    amp, r, x = CABLE[mm2]
    edge(s, t, ad, spec, 'kablo', cap=round(amp * parallel), length=length, r=r / parallel, x=x / parallel, **kw)

ASSUME = 'Varsayım: şemada değer yok; '
K = 0.75  # yük = K × koruma cihazı akımı (yük, cihazın %75'inde çalışıyor varsayımı)

# ---------------------------------------------------------------- KAYNAKLAR
add('grid', 'sebeke', 'Şebeke 34,5 kV', (X(35647), Y(-15500)), dict(gerilim=34500, kisaDevreMva=500, cikisSayisi=1),
    notlar='Varsayım: şemada gösterilmiyor; TX.PL1 primerini (34,5 kV) besleyen kaynak. Kısa devre gücü varsayımdır.')
add('tx', 'trafo', 'TX.PL1', (X(35647), Y(-6055)),
    dict(nominalKva=3150, primerGerilim=34500, sekonderGerilim=V, uk=7, bostaKayip=3.6, yukKayip=27, isiKonum='elektrik', girisSayisi=1, cikisSayisi=1),
    etiket='TX.PL1', notlar='Şema: 3,15 MVA, 34,5 kV / 415 V, Dyn11, AN, empedans %7. Varsayım: boşta ve yük kaybı tipik değerlerdir.')
add('gen1', 'jenerator', 'GEN.PL1.1', (X(24332), Y(-15500)), dict(nominalKva=1800, gerilim=V, pf=0.8, cikisSayisi=1),
    etiket='GEN.PL1.1', notlar='Şema: 2500 A ACB. Varsayım: jeneratör gücü yok; 2500 A × 415 V × √3 ≈ 1800 kVA alındı (iki jeneratör = 5000 A baraya uyar).')
add('gen2', 'jenerator', 'GEN.PL1.2', (X(29926), Y(-15500)), dict(nominalKva=1800, gerilim=V, pf=0.8, cikisSayisi=1),
    etiket='GEN.PL1.2', notlar='Şema: 2500 A ACB. Varsayım: 1800 kVA (GEN.PL1.1 ile aynı).')

breaker('acb_g1a', 'ACB GEN.PL1.1 (jeneratör çıkışı)', 'ACB', 2500, '4P', (24331, -12170), etiket='K1', notlar='Şema: 2500 A / 2500 A, 4P ACB, K1 kilidi.')
breaker('acb_g2a', 'ACB GEN.PL1.2 (jeneratör çıkışı)', 'ACB', 2500, '4P', (29925, -12170), etiket='K1', notlar='Şema: 2500 A, 4P ACB, K1 kilidi.')
breaker('acb_g1b', 'ACB GEN.PL1.1 (senkron panosu)', 'ACB', 2500, '4P', (24331, -7655), notlar='Şema: 2500 A, 4P ACB (PMS).')
breaker('acb_g2b', 'ACB GEN.PL1.2 (senkron panosu)', 'ACB', 2500, '4P', (29931, -7655), notlar='Şema: 2500 A, 4P ACB (PMS).')
bus('sync', 'GEN.PL1 Senkronizasyon panosu (PMS)', 5000, (27100, -6300), tip='senkron', etiket='GEN.PL1',
    notlar='Şema: Synchronization / PMS, jeneratör senkron panosu. Yük paylaşımı: sıralı; toplam yük tek jeneratör kapasitesinin %70\'ine inerse 2. jeneratör kapanır (varsayım: eşik %70, öncelik GEN.PL1.1).')
nodes['sync']['params'].update(mod='sirali', esik=70)
breaker('acb_sync', 'ACB GEN.PL1 çıkış (5000 A)', 'ACB', 5000, '4P', (29510, -5354), notlar='Şema: 5000 A, 4P ACB.')
breaker('acb_gen_in', 'ACB MSB jeneratör girişi', 'ACB', 5000, '3P', (29522, 2365), etiket='PMS', notlar='Şema: 5000 A, 3P ACB (PMS), MSB.PL1 jeneratör girişi.')
breaker('acb_tx', 'ACB MSB trafo girişi', 'ACB', 5000, '3P', (35202, 2344), etiket='PMS', notlar='Şema: 5000 A, 3P ACB (PMS), MSB.PL1 TX.PL1 girişi.')

edge('grid', 'tx', 'Şebeke 34,5 kV', 'şema dışı', 'kablo', cap=200, length=100, gerilim=34500, r=0.3, x=0.12)
edge('tx', 'acb_tx', 'BB/TX.PL1', '5000 A BUSBAR (4P)', cap=5000)
edge('gen1', 'acb_g1a', '', 'jeneratör çıkış kablosu', cap=2500)
edge('gen2', 'acb_g2a', '', 'jeneratör çıkış kablosu', cap=2500)
edge('acb_g1a', 'acb_g1b', '', '', cap=2500)
edge('acb_g2a', 'acb_g2b', '', '', cap=2500)
edge('acb_g1b', 'sync', '', '', cap=2500)
edge('acb_g2b', 'sync', '', '', cap=2500)
edge('sync', 'acb_sync', '', '', cap=5000)
edge('acb_sync', 'acb_gen_in', 'BB/GEN.PL1', '5000 A BUSBAR (5P)', cap=5000)

# ---------------------------------------------------------------- MSB.PL1
bus('msb', 'MSB.PL1', 5000, (35000, 4700), etiket='MSB.PL1',
    notlar='Şema: Main Switchboard, In = 5000 A, Icw = 65 kA / 1 sn, Form 3b IP31.')
edge('acb_tx', 'msb', '', '', cap=5000, length=2)
edge('acb_gen_in', 'msb', '', '', cap=5000, length=2)

# CT / sayaç / parafudr (güç akışını etkilemez)
helper('msb_ct', 'CT 5000/5 A (MSB.PL1)', 'akimTrafosu', (42312, 5777), notlar='Şema: 5000/5 A akım trafosu.')
helper('msb_pqm', 'Güç kalitesi analizörü (PQM) MSB.PL1', 'pqm', (32330, 3541), notlar='Şema: Power Quality Meter (EN50160 verified), PQM.')
helper('msb_spd', 'Parafudr MSB.PL1', 'parafudr', (33233, 5986), notlar='Şema: MCCB + Surge Suppression.')
for h in ('msb_ct', 'msb_pqm', 'msb_spd'):
    edge('msb', h, '', '', cap=100, length=1)

# ---- UPS.PL1.1 ve UPS.PL1.2 (IT UPS, 900 kW) ve UPS.PL1.3 (Essential UPS, 200 kW)
UPS_PARAMS = lambda kw, kva: dict(nominalKva=kva, nominalKw=kw, girisGerilim=V, cikisGerilim=V, verim=96, girisPf=0.99, verimModu='sabit',
                                   verim25=94.5, verim50=96, verim75=96.5, verim100=96.3, bataryaDk=10, isiKonum='elektrik', girisSayisi=1, cikisSayisi=1)
def power_line(n, ups_label, kw, kva, key, x_byp, x_in, x_ups, x_udp_byp, x_udp_ups, udp_x, udp_amp, kind, amp, bb):
    # MSB tarafı
    breaker(f'mb_byp{n}', f'{kind} MSB → UDP.PL1.{n} bypass', kind, amp, '4P', (x_byp, 7657), durum='acik', etiket=key,
            notlar=f'Şema: {amp} A / {amp} A, 4P {kind}, {key} kilidi. Bakım bypass hattı; normalde AÇIK (varsayım: UPS çevrimiçi çalışıyor).')
    breaker(f'mb_in{n}', f'{kind} MSB → UPS.PL1.{n} girişi', kind, amp, '3P', (x_in, 7657), etiket='',
            notlar=f'Şema: {amp} A / {amp} A, 3P {kind}, UPS.PL1.{n} girişi.')
    add(f'ups{n}', 'ups', ups_label, (X(x_ups), Y(18200)), UPS_PARAMS(kw, kva), etiket=f'UPS.PL1.{n}',
        notlar=f'Şema: {kw} kW / {kva} kVA, kAIC > 65 kA, batarya otonomisi ≤ 10 dk (VRLA). Varsayım: verim %96 sabit, giriş PF 0,99.')
    breaker(f'ud_byp{n}', f'{kind} UDP.PL1.{n} bypass girişi', kind, amp, '4P', (x_udp_byp, 25930), durum='acik',
            notlar=f'Şema: {amp} A, 4P {kind}; bypass girişi, normalde AÇIK.')
    breaker(f'ud_ups{n}', f'{kind} UDP.PL1.{n} UPS çıkışı', kind, amp, '4P', (x_udp_ups, 25930), notlar=f'Şema: {amp} A, 4P {kind}; UPS çıkış girişi.')
    bus(f'udp{n}', f'UDP.PL1.{n}', udp_amp, (udp_x, 28200), etiket=f'UDP.PL1.{n}',
        notlar=f'Şema: UPS Distribution Panel, In = {udp_amp} A, Icw = {"65" if n < 3 else "50"} kA / 1 sn, Form 2b IP31.')
    edge('msb', f'mb_byp{n}', '', '', cap=amp, length=2)
    edge('msb', f'mb_in{n}', '', '', cap=amp, length=2)
    return

# UPS.PL1.1
power_line(1, 'UPS.PL1.1 (IT UPS)', 900, 900, 'K3', -15667, -11489, -10600, -15667, -11489, -9000, 1600, 'ACB', 1600, None)
edge('mb_byp1', 'ud_byp1', 'BB/MSB.PL1/01', '1600 A BUSBAR (5P)', cap=1600, length=15)
edge('mb_in1', 'ups1', 'BB/MSB.PL1/02', '1600 A BUSBAR (5P)', cap=1600, length=15)
edge('ups1', 'ud_ups1', 'BB/UPS.PL1.1', '1600 A BUSBAR (5P)', cap=1600, length=10)
edge('ud_byp1', 'udp1', '', '', cap=1600, length=2)
edge('ud_ups1', 'udp1', '', '', cap=1600, length=2)
# UPS.PL1.2
power_line(2, 'UPS.PL1.2 (IT UPS)', 900, 900, 'K4', 14901, 19079, 19970, 14901, 19029, 21000, 1600, 'ACB', 1600, None)
edge('mb_byp2', 'ud_byp2', 'BB/MSB.PL1/03', '1600 A BUSBAR (5P)', cap=1600, length=15)
edge('mb_in2', 'ups2', 'BB/MSB.PL1/04', '1600 A BUSBAR (5P)', cap=1600, length=15)
edge('ups2', 'ud_ups2', 'BB/UPS.PL1.2', '1600 A BUSBAR (5P)', cap=1600, length=10)
edge('ud_byp2', 'udp2', '', '', cap=1600, length=2)
edge('ud_ups2', 'udp2', '', '', cap=1600, length=2)
# UPS.PL1.3 (Essential UPS, MCCB 400 A, kablolu)
power_line(3, 'UPS.PL1.3 (Essential UPS)', 200, 200, 'K5', 49926, 53925, 54778, 49887, 53886, 51500, 400, 'MCCB', 400, None)
cable('mb_byp3', 'ud_byp3', 'CBL/MSB.PL1/01', '2x(4x95)+95 mm² N2XH', 2, 95)
cable('mb_in3', 'ups3', 'CBL/MSB.PL1/02', '2x(4x95)+95 mm² N2XH', 2, 95)
cable('ups3', 'ud_ups3', 'CBL/UPS.PL1.3', '2x(4x95)+95 mm² N2XH', 2, 95)
edge('ud_byp3', 'udp3', '', '', cap=400, length=2)
edge('ud_ups3', 'udp3', '', '', cap=400, length=2)

# ---------------------------------------------------------------- UDP çıkışları + STS panoları
CATCHER_SRC = 'catcher_src'
add(CATCHER_SRC, 'sebeke', 'Catcher kaynağı (BB/CRP.PL1.1, şema dışı)', (X(6000), Y(33000)), dict(gerilim=V, kisaDevreMva=500, cikisSayisi=1),
    notlar='Varsayım: BB/CRP.PL1.1 barasının üst ucu "Circuit Reference" ile başka şemaya gidiyor; kaynağı bilinmiyor, kapasite sınırsız kabul edildi (415 V).')
bus('catcher_bus', 'BB/CRP.PL1.1 (catcher barası)', 2500, (6000, 38200), tip='bara', etiket='BB/CRP.PL1.1', notlar='Şema: 2500 A BUSBAR (5P). Dört STS\'nin B kaynağı.')
edge(CATCHER_SRC, 'catcher_bus', 'BB/CRP.PL1.1', '2500 A BUSBAR (5P)', cap=2500, length=20)

def stsb(tag, xs, udp, udp_x_out, bb_ad):
    """STS panosu: A = UDP.PL1.x çıkış barası, B = catcher barası; bakım bypass ayırıcıları normalde açık."""
    xa, xb = xs - 1300, xs + 1300
    bus(f'{tag}_inA', f'STSSB.PL1.{tag} A girişi', 1250, (xa, 41500), tip='bara', notlar='STS A kaynağı giriş terminali (bypass ayırıcısı ve STS ACB\'sine dallanır).')
    bus(f'{tag}_inB', f'STSSB.PL1.{tag} B girişi', 1250, (xb, 43500), tip='bara', notlar='STS B (catcher) kaynağı giriş terminali.')
    breaker(f'{tag}_acbA', f'ACB STS.PL1.{tag} A', 'ACB', 1250, '4P', (xa, 47800), notlar='Şema: 1250 A / 1250 A, 4P ACB (STS A kaynak tarafı).')
    breaker(f'{tag}_acbB', f'ACB STS.PL1.{tag} B', 'ACB', 1250, '4P', (xb, 47800), notlar='Şema: 1250 A / 1250 A, 4P ACB (STS B kaynak tarafı).')
    add(f'{tag}_sts', 'sts', f'STS.PL1.{tag}', (X(xs), Y(50800)), dict(gerilim=V, nominalAkim=1250, diversity=1, girisSayisi=2, cikisSayisi=1),
        etiket=f'STS.PL1.{tag}', notlar=f'Şema: STSSB.PL1.{tag}, In = 1250 A, Icw = 65 kA / 1 sn, Form 2b IP31, 1250 A 4P. Tercih: A kaynağı (UPS); B = catcher.')
    breaker(f'{tag}_isoA', f'Ayırıcı STSSB.PL1.{tag} A bypass', 'Ayırıcı', 1250, '4P', (xs - 3300, 50300), durum='acik',
            notlar='Şema: bakım bypass ayırıcısı (A kaynağı → çıkış). Normalde AÇIK.')
    breaker(f'{tag}_isoB', f'Ayırıcı STSSB.PL1.{tag} B bypass', 'Ayırıcı', 1250, '4P', (xs + 3300, 50300), durum='acik',
            notlar='Şema: bakım bypass ayırıcısı (B kaynağı → çıkış). Normalde AÇIK.')
    bus(f'{tag}_out', f'STSSB.PL1.{tag} çıkış barası', 1250, (xs, 54300), tip='bara', etiket=f'STSSB.PL1.{tag}', notlar='STS çıkışı ve bypass yollarının birleştiği çıkış terminali.')
    load(f'{tag}_load', f'IT yükü STSSB.PL1.{tag} (şema dışı)', 270, (xs, 59800), kategori='IT', pf=0.95, isi='salon',
         notlar=ASSUME + 'şema bu çıkışı başka sayfaya referanslıyor (Circuit Reference). 270 kW IT yükü varsayıldı (iki STS + RPP ile UPS.PL1.x ≈ %73 yüklenir).')
    edge(f'{tag}_inA', f'{tag}_acbA', '', '', cap=1250, length=2)
    edge(f'{tag}_inA', f'{tag}_isoA', '', 'bakım bypass', cap=1250, length=3)
    edge(f'{tag}_inB', f'{tag}_acbB', '', '', cap=1250, length=2)
    edge(f'{tag}_inB', f'{tag}_isoB', '', 'bakım bypass', cap=1250, length=3)
    edge(f'{tag}_acbA', f'{tag}_sts', '', '', cap=1250, length=2, pay=100)   # tercih: UPS kaynağı
    edge(f'{tag}_acbB', f'{tag}_sts', '', '', cap=1250, length=2, pay=0)     # yedek: catcher
    edge(f'{tag}_sts', f'{tag}_out', '', '', cap=1250, length=2)
    edge(f'{tag}_isoA', f'{tag}_out', '', '', cap=1250, length=3)
    edge(f'{tag}_isoB', f'{tag}_out', '', '', cap=1250, length=3)
    edge(f'{tag}_out', f'{tag}_load', bb_ad, '1250 A BUSBAR (5P)', cap=1250, length=15)
    edge('catcher_bus', f'{tag}_inB', '', 'catcher beslemesi', cap=1250, length=10)

def udp_outputs(n, x0, x_acb1, x_acb2, x_mccb, x_lb, x_ct, x_em, x_spd, rpp_name, rpp_x, mccb_amp, cbl_name, lb_x_out, sts_tags, sts_x):
    u = f'udp{n}'
    breaker(f'uo{n}_a', f'ACB UDP.PL1.{n} → STS.PL1.{n}A', 'ACB', 1250, '4P', (x_acb1, 31531), notlar='Şema: 1250 A / 1250 A, 4P ACB.')
    breaker(f'uo{n}_b', f'ACB UDP.PL1.{n} → STS.PL1.{n}B', 'ACB', 1250, '4P', (x_acb2, 31531), notlar='Şema: 1250 A / 1250 A, 4P ACB.')
    breaker(f'uo{n}_r', f'MCCB UDP.PL1.{n} → {rpp_name}', 'MCCB', 160, '4P', (x_mccb, 31508), notlar='Şema: 160 A / 250 A, 4P MCCB (160 A ayar).')
    breaker(f'uo{n}_lb', f'ACB UDP.PL1.{n} load bank', 'ACB', 1250, '4P', (x_lb, 31508), durum='acik', etiket='K2',
            notlar='Şema: 1250 A / 1250 A, 4P ACB, K2 kilidi; UPS testi için load bank bağlantısı. Normalde AÇIK.')
    helper(f'udp{n}_ct', f'CT {"1600/5" if n < 3 else "400/5"} A (UDP.PL1.{n})', 'akimTrafosu', (x_ct, 29481), notlar='Şema: akım trafosu.')
    helper(f'udp{n}_em', f'Enerji sayacı (EM) UDP.PL1.{n}', 'sayac', (x_em, 28737), notlar='Şema: EM sayaç.')
    helper(f'udp{n}_spd', f'Parafudr UDP.PL1.{n}', 'parafudr', (x_spd, 29688), notlar='Şema: MCCB + Surge Suppression.')
    for h in (f'udp{n}_ct', f'udp{n}_em', f'udp{n}_spd'):
        edge(u, h, '', '', cap=100, length=1)
    for b in (f'uo{n}_a', f'uo{n}_b', f'uo{n}_r', f'uo{n}_lb'):
        edge(u, b, '', '', cap=1250 if b != f'uo{n}_r' else 160, length=2)
    # RPP
    load(f'rpp{n}', rpp_name + ' (IT)', 82, (rpp_x, 42700), kategori='IT', pf=0.95, isi='salon', etiket=rpp_name,
         notlar=ASSUME + '160 A MCCB: 0,75 × √3 × 415 V × 160 A × cosφ 0,95 ≈ 82 kW.')
    cable(f'uo{n}_r', f'rpp{n}', cbl_name, '2x(4x70)+70 mm² N2XH', 2, 70, length=40)
    # load bank
    load(f'lb{n}', f'Load bank bağlantısı UDP.PL1.{n} (harici)', 0, (lb_x_out, 38000), kategori='Mekanik', pf=1, isi='dis', typ='genelYuk',
         notlar='Şema: Load Bank Busbar (1250 A, 5P) UPS testi için harici load bank bağlantı noktası. Güç yok (0 kW).')
    edge(f'uo{n}_lb', f'lb{n}', 'BB/LB', '1250 A BUSBAR (5P)', cap=1250, length=10)

udp_outputs(1, 0, -15661, -3579, -986, 3460, -13725, -12518, -7129, 'RPP.POP.1A', -2227, 160, 'CBL.UDP.PL1.1/01', 3005, ('1A', '1B'), None)
udp_outputs(2, 0, 14906, 27096, 29582, 34028, 16843, 18050, 23439, 'RPP.POP.2A', 28341, 160, 'CBL.UDP.PL1.2/01', 33573, ('2A', '2B'), None)
# STS panoları
stsb('1A', -15700, 1, None, 'BB/STSSB.PL1.1A')
stsb('1B', -3600, 1, None, 'BB/STSSB.PL1.1B')
stsb('2A', 15700, 2, None, 'BB/STSSB.PL1.2A')
stsb('2B', 27700, 2, None, 'BB/STSSB.PL1.2B')
edge('uo1_a', '1A_inA', 'BB/UDP.PL1.1/01', '1250 A BUSBAR (5P)', cap=1250, length=20)
edge('uo1_b', '1B_inA', 'BB/UDP.PL1.1/02', '1250 A BUSBAR (5P)', cap=1250, length=20)
edge('uo2_a', '2A_inA', 'BB/UDP.PL1.2/01', '1250 A BUSBAR (5P)', cap=1250, length=20)
edge('uo2_b', '2B_inA', 'BB/UDP.PL1.2/02', '1250 A BUSBAR (5P)', cap=1250, length=20)

# ---- UDP.PL1.3 çıkışları (MCCB, kablo)
helper('udp3_ct', 'CT 400/5 A (UDP.PL1.3)', 'akimTrafosu', (51043, 29481), notlar='Şema: 400/5 A akım trafosu.')
helper('udp3_em', 'Enerji sayacı (EM) UDP.PL1.3', 'sayac', (52350, 28737), notlar='Şema: EM sayaç.')
helper('udp3_spd', 'Parafudr UDP.PL1.3', 'parafudr', (47305, 29688), notlar='Şema: MCCB + Surge Suppression.')
for h in ('udp3_ct', 'udp3_em', 'udp3_spd'):
    edge('udp3', h, '', '', cap=100, length=1)
breaker('uo3_1', 'MCCB UDP.PL1.3 → UDB.PL1.1', 'MCCB', 125, '4P', (48856, 31508), notlar='Şema: 125 A / 125 A, 4P MCCB.')
breaker('uo3_2', 'MCCB UDP.PL1.3 → UDB.PL1.2', 'MCCB', 250, '4P', (53656, 31508), notlar='Şema: 250 A / 250 A, 4P MCCB.')
edge('udp3', 'uo3_1', '', '', cap=125, length=2)
edge('udp3', 'uo3_2', '', '', cap=250, length=2)
load('udb1', 'UDB.PL1.1 (FWU UDB)', 40, (47864, 42400), pf=0.85, isi='dis', etiket='UDB.PL1.1', notlar=ASSUME + '125 A MCCB altındaki FWU UDB yükü bilinmiyor; 40 kW alındı.')
add('udb2', 'dagitimPanosu', 'UDB.PL1.2 (Mechanical UDB)', (X(52730), Y(42400)), dict(gerilim=V, nominalAkim=250, diversity=1, girisSayisi=1, cikisSayisi=2),
    etiket='UDB.PL1.2', notlar='Şema: Mechanical UDB (içeriği şemada yok).')
load('udb2_load', 'UDB.PL1.2 yükleri (şema dışı)', 30, (52000, 47500), pf=0.85, isi='dis', notlar=ASSUME + 'UDB.PL1.2 kendi yükü; 30 kW alındı.')
load('udb3', 'UDB.PL1.3 (Chiller Pump Room UDB)', 40, (53800, 51334), pf=0.85, isi='dis', etiket='UDB.PL1.3', notlar=ASSUME + 'UDB.PL1.2 üzerinden beslenen pompa odası UDB yükü; 40 kW alındı.')
cable('uo3_1', 'udb1', 'CBL/UDP.PL1.3/01', '4x70+70 mm² N2XH', 1, 70)
cable('uo3_2', 'udb2', 'CBL/UDP.PL1.3/02', '4x70+35 mm² N2XH', 1, 70)
edge('udb2', 'udb2_load', '', '', cap=250, length=2)
cable('udb2', 'udb3', 'CBL/UDB.PL1.2/01', '4x50+25 mm² N2XH', 1, 50)

# ---------------------------------------------------------------- MSB mekanik / yardımcı besleyiciler
def feeder(id, ad, amp_trip, frame, pole, x, bar_name, spec, mm2, parallel, load_id, load_ad, kw, pf, isi, typ='mekanikYuk', kategori='Mekanik', cable_len=40, durum='kapali', note='', y=7701, note2=''):
    breaker(id, ad, 'MCCB', amp_trip, pole, (x, y), durum=durum, notlar=f'Şema: {amp_trip} A / {frame} A, {pole} MCCB.' + note)
    edge('msb', id, '', '', cap=amp_trip, length=2)
    load(load_id, load_ad, kw, (x + 300, 14500), kategori=kategori, pf=pf, isi=isi, typ=typ, etiket=load_ad.split(' ')[0],
         notlar=ASSUME + f'{amp_trip} A MCCB: {K} × √3 × 415 V × {amp_trip} A × cosφ {pf} ≈ {kw} kW.' + note2)
    cable(id, load_id, bar_name, spec, parallel, mm2, length=cable_len)

feeder('mf_acc1', 'MCCB ACC-01 Module-1 Chiller-1', 630, 630, '4P', 73763, 'CBL/MSB.PL1/03', '2x(4x95)+120 mm² N2XH', 120, 2, 'acc1', 'ACC-01 Module-1 Chiller-1', round(K * p3(630, 0.85)), 0.85, 'dis')
feeder('mf_acc2', 'MCCB ACC-02 Module-1 Chiller-2', 630, 630, '4P', 75763, 'CBL/MSB.PL1/04', '2x(4x95)+120 mm² N2XH', 120, 2, 'acc2', 'ACC-02 Module-1 Chiller-2', round(K * p3(630, 0.85)), 0.85, 'dis')
feeder('mf_gaux1', 'MCCB GEN.PL1.1 Aux. Loads', 100, 250, '4P', 77763, 'CBL/MSB.PL1/05', '5x16 mm² N2XH', 16, 1, 'gaux1', 'GEN.PL1.1 Aux. Loads', round(K * p3(100, 0.85)), 0.85, 'dis')
feeder('mf_gaux2', 'MCCB GEN.PL1.2 Aux. Loads', 100, 250, '4P', 79763, 'CBL/MSB.PL1/08', '5x16 mm² N2XH', 16, 1, 'gaux2', 'GEN.PL1.2 Aux. Loads', round(K * p3(100, 0.85)), 0.85, 'dis')
feeder('mf_db1', 'MCCB DB.PL1.1 (Small Power and Lighting DB)', 63, 250, '4P', 82963, 'CBL/MSB.PL1/06', '5x35 mm² N2XH', 35, 1, 'db1', 'DB.PL1.1 (Small Power and Lighting DB)', round(K * p3(63, 0.9)), 0.9, 'salon', typ='aydinlatma')
feeder('mf_db2', 'MCCB DB.PL1.2 (Mechanical DB)', 630, 630, '4P', 87662, 'CBL/MSB.PL1/07', '2x(4x70)+70 mm² N2XH', 70, 2, 'db2', 'DB.PL1.2 (Mechanical DB)', round(K * p3(246 * 2, 0.85)), 0.85, 'dis', note2=' Kablo (2x(4x70), ≈492 A) 630 A MCCB\'den küçük olduğundan yük kablo kapasitesine göre alındı.')
breaker('mf_spare', 'MCCB Spare (200 kVAr kompanzasyon)', 'MCCB', 400, '4P', (91662, 7701), durum='acik', notlar='Şema: 400 A / 400 A, 4P MCCB, "Base Only" (yalnızca taban/yer ayrılmış). Varsayım: kurulu değil, AÇIK.')
edge('msb', 'mf_spare', '', '', cap=400, length=2)
load('spare_pfc', 'Spare (200 kVAr güç kalitesi kompanzasyonu)', 0, (91962, 14500), pf=1, isi='elektrik', typ='genelYuk', notlar='Şema: Spare (200 kVAr Compensation of Power Quality). Henüz kurulu değil: 0 kW.')
edge('mf_spare', 'spare_pfc', '', 'spare', 'kablo', cap=400, length=10)

# Load bank (MSB)
breaker('mf_lb', 'ACB MSB load bank', 'ACB', 5000, '4P', (16965, 2365), durum='acik', etiket='K2',
        notlar='Şema: 5000 A / 5000 A, 4P ACB, K2 kilidi; jeneratör testi / roll-up jeneratör için load bank barası. Normalde AÇIK.')
edge('msb', 'mf_lb', '', '', cap=5000, length=2)
load('lb_msb', 'Load bank bağlantısı MSB.PL1 (harici)', 0, (16965, -9670), pf=1, isi='dis', typ='genelYuk', notlar='Şema: Load Bank Busbar (5000 A, 5P). Harici load bank / roll-up jeneratör bağlantısı. 0 kW.')
edge('mf_lb', 'lb_msb', 'BB/LB', '5000 A BUSBAR (5P)', cap=5000, length=15)

# ---------------------------------------------------------------- CRP.PL1.1 (catcher redundancy panel)
add('crp_src', 'sebeke', 'CRP.PL1.1 beslemesi (şema dışı)', (X(76440), Y(52000)), dict(gerilim=V, kisaDevreMva=500, cikisSayisi=1),
    notlar='Varsayım: CRP.PL1.1 girişi (2500 A ACB) şema dışına gidiyor; kaynağı bilinmiyor, kapasite sınırsız kabul edildi.')
breaker('crp_in', 'ACB CRP.PL1.1 girişi', 'ACB', 2500, '4P', (76466, 56947), notlar='Şema: 2500 A / 2500 A, 4P ACB.')
bus('crp', 'CRP.PL1.1 (Catcher Redundancy Panel)', 2500, (76440, 59500), etiket='CRP.PL1.1', notlar='Şema: Catcher Redundancy Panel, In = 2500 A, Icw = 65 kA / 1 sn, Form 2b IP31.')
breaker('crp_c1', 'ACB CRP.PL1.1 → Catcher 01', 'ACB', 2500, '4P', (74884, 62000), etiket='Auto', notlar='Şema: 2500 A / 2500 A, 4P ACB, Auto (PMS).')
breaker('crp_c2', 'ACB CRP.PL1.1 → Catcher 02', 'ACB', 2500, '4P', (80468, 62000), etiket='Auto', notlar='Şema: 2500 A / 2500 A, 4P ACB, Auto (PMS).')
load('cat1', 'Busbar Catcher 01 (şema dışı bağlantı)', 0, (74884, 66500), pf=1, isi='elektrik', typ='genelYuk', notlar='Şema: BB/C1, 2500 A BUSBAR (5P); diğer hatlara giden catcher barası. 0 kW.')
load('cat2', 'Busbar Catcher 02 (şema dışı bağlantı)', 0, (80468, 66500), pf=1, isi='elektrik', typ='genelYuk', notlar='Şema: BB/C2, 2500 A BUSBAR (5P). 0 kW.')
edge('crp_src', 'crp_in', '', 'şema dışı besleme', cap=2500, length=10)
edge('crp_in', 'crp', '', '', cap=2500, length=2)
edge('crp', 'crp_c1', '', '', cap=2500, length=2)
edge('crp', 'crp_c2', '', '', cap=2500, length=2)
edge('crp_c1', 'cat1', 'BB/C1', '2500 A BUSBAR (5P)', cap=2500, length=10)
edge('crp_c2', 'cat2', 'BB/C2', '2500 A BUSBAR (5P)', cap=2500, length=10)

# Bakım bypass kesicileri: UPS arızasında (UDP enerjisiz kalırsa) OTOMATİK KAPANIR -> UDP doğrudan MSB'den beslenir.
for n_ in (1, 2, 3):
    for k_ in (f'mb_byp{n_}', f'ud_byp{n_}'):
        nodes[k_]['params']['otomatik'] = 'otomatik'
        nodes[k_]['notlar'] += ' Otomatik kapanır: UPS arızasında hard bypass ON konumuna geçer, UDP doğrudan MSB\'den beslenir.'

# ---------------------------------------------------------------- port ataması (x sırasına göre)
def nx(n): return nodes[n]['x']
outs, ins = {}, {}
for e in edges:
    outs.setdefault(e['source'], []).append(e)
    ins.setdefault(e['target'], []).append(e)
for n, es in outs.items():
    for i, e in enumerate(sorted(es, key=lambda e: (nx(e['target']), e['id']))): e['kaynakPort'] = i
for n, es in ins.items():
    for i, e in enumerate(sorted(es, key=lambda e: (nx(e['source']), e['id']))): e['hedefPort'] = i
for e in edges:
    e.setdefault('kaynakPort', 0); e.setdefault('hedefPort', 0)
DEFAULT_PORTS = {'sebeke': (0, 1), 'jenerator': (0, 1), 'trafo': (1, 1), 'mdb': (2, 6), 'dagitimPanosu': (1, 6), 'bara': (2, 8), 'ups': (1, 1),
                 'ats': (2, 1), 'sts': (2, 1), 'kesici': (1, 1), 'yardimci': (1, 0), 'senkron': (2, 1), 'itYuku': (1, 0), 'mekanikYuk': (1, 0), 'aydinlatma': (1, 0), 'genelYuk': (1, 0)}
for n in nodes.values():
    di, do = DEFAULT_PORTS[n['type']]
    if di: n['params']['girisSayisi'] = max(di, len(ins.get(n['id'], [])), n['params'].get('girisSayisi', 0))
    if do: n['params']['cikisSayisi'] = max(do, len(outs.get(n['id'], [])), n['params'].get('cikisSayisi', 0))
    # Pano/bara: yalnızca çizilen port kadar (şemadaki gibi); gereksiz boş port bırakma.
    if n['type'] in ('mdb', 'dagitimPanosu', 'bara', 'senkron'):
        n['params']['girisSayisi'] = max(1, len(ins.get(n['id'], [])))
        n['params']['cikisSayisi'] = max(1, len(outs.get(n['id'], [])))

# ---------------------------------------------------------------- çakışma çözümü (kartlar üst üste binmesin)
def size(n):
    # İkon + sağında ekipman adı (≈140 px) birlikte yer kaplar.
    t = n['type']
    small = t in ('kesici', 'yardimci')
    ports = max(n['params'].get('girisSayisi', 1), n['params'].get('cikisSayisi', 1))
    icon_w = max(36 if small else 48, ports * 16 + 8)
    return icon_w + 140, 44 if small else 54
ids = list(nodes)
for _ in range(60):
    moved = False
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = nodes[ids[i]], nodes[ids[j]]
            wa, ha = size(a); wb, hb = size(b)
            dx = (b['x'] + wb / 2) - (a['x'] + wa / 2); dy = (b['y'] + hb / 2) - (a['y'] + ha / 2)
            ox = (wa + wb) / 2 + 6 - abs(dx); oy = (ha + hb) / 2 + 14 - abs(dy)
            if ox > 0 and oy > 0:
                if ox <= oy:
                    s = 1 if dx >= 0 else -1; a['x'] -= s * ox / 2; b['x'] += s * ox / 2
                else:
                    s = 1 if dy >= 0 else -1; a['y'] -= s * oy / 2; b['y'] += s * oy / 2
                moved = True
    if not moved: break
for n in nodes.values():
    n['x'] = round(n['x']); n['y'] = round(n['y'])

SCENARIOS = [
    dict(id='sen_tx', ad='TX.PL1 arızası (jeneratörler devralır)', failedNodes=['tx'], edgeStates={}, nodeStates={}),
    dict(id='sen_ups1', ad='UPS.PL1.1 arızası (otomatik hard bypass)', failedNodes=['ups1'], edgeStates={}, nodeStates={}),
    dict(id='sen_ups1_byp', ad='UPS.PL1.1 bakım: bypass ACB\'ler ELLE kapatıldı', failedNodes=['ups1'], edgeStates={},
         nodeStates={'mb_byp1': 'kapali', 'ud_byp1': 'kapali', 'ud_ups1': 'acik', 'mb_in1': 'acik'}),
    dict(id='sen_ups3', ad='UPS.PL1.3 arızası (Essential UPS, otomatik bypass)', failedNodes=['ups3'], edgeStates={}, nodeStates={}),
    dict(id='sen_tx_gen1', ad='TX.PL1 + GEN.PL1.1 arızası (tek jeneratör)', failedNodes=['tx', 'gen1'], edgeStates={}, nodeStates={}),
]
proj = dict(schemaVersion=6, id='hdc02_pl1', name='HDC02 PL1 — LV Distribution Power Line-up 1',
            createdAt='2026-01-01T00:00:00.000Z', updatedAt='2026-01-01T00:00:00.000Z',
            nodes=list(nodes.values()), edges=edges, scenarios=SCENARIOS)
out = os.path.join(os.path.dirname(__file__), '..', 'examples', 'hdc02-pl1.dcalc.json')
json.dump(proj, open(out, 'w'), indent=1, ensure_ascii=False)
print(len(nodes), 'düğüm,', len(edges), 'hat ->', os.path.normpath(out))
