#!/usr/bin/env python3
"""
HDC02-ARP-RP-E-DD-ZZ-ZZ-POWR-7002 "LV Cable Schedule" belgesinden C1 ve C2 bloklarının hat tanımını
(examples/hdc02-c1c2.hatlar.json) üretir; uygulama bu dosyayı "Hat çizelgesi" olarak yükleyip C1/C2 ekipmanını
kablo, bara ve şalterlerle bağlar (src/model/hatCizelgesi.ts).

Kullanım:
  python3 scripts/build-hdc02-c1c2.py                     # JSON üretir
  python3 scripts/build-hdc02-c1c2.py --pdf cizelge.pdf   # ayrıca her satırı PDF metniyle karşılaştırır (pdfplumber)

Veri kaynağı sayfaları (PDF):
  C1: özet 7 · kaynak 26 · kablo 27 · pano 28 · DB 29 · bara 30 · tap-off 31 · tee 32
  C2: özet 8 · kaynak 33 · kablo 34 · pano 35 · DB 36 · bara 37 · tap-off 38 · tee 39
Çizelgede OLMAYAN değerler (jeneratör gücü, UPS giriş/çıkış şalterleri, kablo uzunluğu olmayan bağlantılar) VARSAYIMDIR:
hat kaydında "veri": "varsayim" ve düğüm notunda "Varsayım:" ile işaretlidir.
"""
import argparse, json, os, re, sys

BLOKLAR = [  # (ad, no, sayfalar)
    ('C1', 1, dict(ozet=7, kaynak=26, kablo=27, pano=28, db=29, bara=30, tap=31, tee=32)),
    ('C2', 2, dict(ozet=8, kaynak=33, kablo=34, pano=35, db=36, bara=37, tap=38, tee=39)),
]
V = 415

# Kablo kesitine göre Cu XLPE akım taşıma (IEC 60364-5-52, açık tava) ve R/X (Ω/km); build-hdc02-pl1.py ile aynı değerler.
CABLE = {16: (99, 1.15, 0.09), 25: (131, 0.727, 0.086), 35: (158, 0.524, 0.085), 50: (192, 0.387, 0.083),
         70: (246, 0.268, 0.082), 95: (298, 0.193, 0.081), 120: (346, 0.153, 0.080)}


def kablo(paralel, damar, kesit, pe=None, **kw):
    """Çizelgedeki 'n x 1 x kc' kablo: paralel kablo sayısı, damar sayısı, faz kesiti, PE kesiti (ayrı iletkense)."""
    ad = f'{paralel}x({damar}x{kesit})' if paralel > 1 else f'{damar}x{kesit}'
    if pe and damar == 4:
        ad += f'+{pe}'
    d = dict(paralel=paralel, damar=damar, kesit=kesit, metin=ad + ' mm² N2XH')
    if pe:
        d['pe'] = pe
    amp, r, x = CABLE[kesit]
    d['akim'] = round(amp * paralel)
    d['r'] = round(r / paralel, 4)
    d['x'] = round(x / paralel, 4)
    d.update(kw)
    return d


def kesici(ad, tip, akim, icu, kutup='4P', durum='kapali', otomatik='yok', veri='cizelge', sayfa='', not_=''):
    return dict(ad=ad, tip=tip, akim=akim, icu=icu, kutup=kutup, durum=durum, otomatik=otomatik, veri=veri, sayfa=sayfa, **({'not': not_} if not_ else {}))


dugumler, hatlar = [], []
temizle = dict(dugumler=[], hatlar=[])
CUR = ['']  # üretilen blok (C1/C2); blok dışı kayıtlarda ''


def dugum(ref, tur, ad, alias=None, params=None, varsayilan=None, olustur=True, not_='', grup='', cizelge=None):
    d = dict(ref=ref, tur=tur, ad=ad, olustur=olustur)
    if cizelge:
        d['cizelge'] = cizelge
    if alias:
        d['alias'] = alias
    if params:
        d['params'] = params
    if varsayilan:
        d['varsayilan'] = varsayilan
    if not_:
        d['not'] = not_
    if grup:
        d['grup'] = grup
    dugumler.append(d)


def hat(ad, tip, kaynak, hedef, uzunluk, sayfa, akim=None, kablo_=None, k=None, hk=None, veri='cizelge', grup='', aciklama='', gerilim=V, uzunluk_kaynak=None, pay=None):
    d = dict(ad=ad, tip=tip, kaynak=kaynak, hedef=hedef, uzunluk=uzunluk, sayfa=sayfa, veri=veri, blok=CUR[0])
    if akim is not None:
        d['akim'] = akim
    if kablo_:
        d['kablo'] = kablo_
    if k:
        d['kesici'] = k
    if hk:
        d['hedefKesici'] = hk
    if grup:
        d['grup'] = grup
    if aciklama:
        d['aciklama'] = aciklama
    if gerilim != V:
        d['gerilim'] = gerilim
    if uzunluk_kaynak:
        d['uzunlukKaynak'] = uzunluk_kaynak
    if pay is not None:
        d['pay'] = pay
    hatlar.append(d)


def ras(sayfa, *kelimeler):
    return ''.join(kelimeler)


for B, N, P in BLOKLAR:
    CUR[0] = B
    ref = lambda s: f'{B}:{s}'
    ozet, kab, pano, bar, kay = P['ozet'], P['kablo'], P['pano'], P['bara'], P['kaynak']

    # ------------------------------------------------------------------ düğümler
    dugum(ref('grid'), 'sebeke', f'Şebeke 34,5 kV ({B})', params=dict(gerilim=34500, kisaDevreMva=1240, cikisSayisi=1),
          not_=f'Çizelge s.{kay}: TX.{B} primer kısa devre gücü 1240 MVA (34,5 kV). Şebeke bağlantı noktası ve OG kablo çizelgede yok (varsayım: tek besleme).')
    dugum(ref('rmu'), 'rmu', f'RMU.{B}', alias=[f'RMU.{B}'], params=dict(gerilim=34500),
          not_='Varsayım: RMU çizelgede yok (plandan geldi); şebeke → RMU → TX bağlantısı varsayımdır.')
    dugum(ref('tx'), 'trafo', f'TX.{B}', alias=[f'TX.{B}'],
          params=dict(primerGerilim=34500, sekonderGerilim=V, nominalKva=3150, uk=7, bostaKayip=3.6, yukKayip=27),
          not_=f'Çizelge s.{kay}: 3150 kVA, 34,5 kV/415 V, empedans %7, sekonder 5000 A ACB (LSIG, 70 kA). Varsayım: boşta/yük kaybı tipik değerlerdir (TX.PL1 ile aynı).')
    dugum(ref('gen1'), 'jenerator', f'GEN.{B}.1', alias=[f'GEN.{B}.1'], params=dict(gerilim=V),
          varsayilan=dict(nominalKva=1800, pf=0.8),
          not_=f'Varsayım: jeneratör gücü çizelgede yok (yalnızca BB/GEN.{B} 5000 A ve GEN.{B}.1 Aux. beslemesi var); GEN.PL1.1 gibi 1800 kVA alındı.')
    dugum(ref('gen2'), 'jenerator', f'GEN.{B}.2', alias=[f'GEN.{B}.2'], params=dict(gerilim=V),
          varsayilan=dict(nominalKva=1800, pf=0.8),
          not_='Varsayım: GEN.%s.1 ile aynı (1800 kVA).' % B)
    dugum(ref('sync'), 'senkron', f'GEN.{B} Senkronizasyon panosu (PMS)', alias=[f'GEN.{B} Senkronizasyon panosu (PMS)'],
          params=dict(gerilim=V, nominalAkim=5000, mod='sirali', esik=70, girisSayisi=2, cikisSayisi=1),
          not_=f'Varsayım: GEN.{B} jeneratör senkron/PMS panosu çizelgede gösterilmiyor; GEN.PL1 düzeni örnek alındı (sıralı yük paylaşımı, eşik %70).')
    dugum(ref('msb'), 'mdb', f'MSB.{B}', alias=[f'MSB.{B}'], params=dict(gerilim=V, nominalAkim=5000),
          not_=f'Çizelge s.{pano}: MSB.{B} 415 V, ACB 5000 A, Icu 70 kA.')
    for i, kw in ((1, 850), (2, 850), (3, 200)):
        dugum(ref(f'ups{i}'), 'ups', f'UPS.{B}.{i}', alias=[f'UPS.{B}.{i}'], params=dict(girisGerilim=V, cikisGerilim=V),
              varsayilan=dict(nominalKw=kw, nominalKva=round(kw / 0.9)),
              not_=f'Varsayım: UPS gücü çizelgede yok ({kw} kW; plandaki değer/UPS.PL1 örneği).')
    dugum(ref('udp1'), 'mdb', f'UDP.{B}.1', alias=[f'UDP.{B}.1'], params=dict(gerilim=V, nominalAkim=2500),
          not_=f'Çizelge s.{pano}: UDP.{B}.1 415 V, ACB 2500 A, Icu 70 kA.')
    dugum(ref('udp2'), 'mdb', f'UDP.{B}.2', alias=[f'UDP.{B}.2'], params=dict(gerilim=V, nominalAkim=400),
          not_=f'Çizelge s.{pano}: UDP.{B}.2 415 V, MCCB 400 A, Icu 70 kA.')
    for i, amp in ((1, 160), (2, 63), (4, 63)):
        dugum(ref(f'udb{i}'), 'dagitimPanosu', f'UDB.{B}.{i}', alias=[f'UDB.{B}.{i}'], params=dict(gerilim=V, nominalAkim=amp))
    # uç yükler (çizelge s.29/36 "Distribution Board": bağlı yük kW / kVAr / kVA)
    def yuk(rf, tur, ad, kw, kva, kvar, isi, kat='Mekanik', not_='', satir='', pdf=None):
        pf = round(kw / kva, 3) if kva else 1
        dugum(ref(rf), tur, ad, alias=[ad], params=dict(gerilim=V),
              varsayilan=dict(kuruluKw=kw, pf=pf, df=1, kategori=kat, isiKonum=isi),
              cizelge=dict(sayfa=P['db'], satir=satir, kw=pdf[0] if pdf else kw, kvar=pdf[2] if pdf else kvar, kva=pdf[1] if pdf else kva),
              not_=(f'Çizelge s.{P["db"]}: {kw} kW / {kvar} kVAr / {kva} kVA (diversity 1).' if not pdf else f'Çizelge s.{P["db"]}: {pdf[0]} kW / {pdf[2]} kVAr / {pdf[1]} kVA.') + (' ' + not_ if not_ else ''))
    yuk('gaux1', 'mekanikYuk', f'GEN.{B}.1 Aux. Loads', 15, 15.79, 4.93, 'dis', satir=f'GEN.{B}.1 Aux.')
    yuk('gaux2', 'mekanikYuk', f'GEN.{B}.2 Aux. Loads', 15, 15.79, 4.93, 'dis', satir=f'GEN.{B}.2 Aux.')
    yuk('mmr', 'itYuku', f'MMR-1 DC Supply ({B} ikincil besleme)', 100, 100, 0, 'elektrik', kat='IT', satir='MMR-1 DC Supply',
        not_='DC güç santrali (MMR-1) ikincil beslemesi; BT/telekom yükü olarak IT sayıldı.')
    yuk('chiller', 'mekanikYuk', f'Chiller Redundant Supply ({B})', 430.2, 452.84, 141.4, 'dis', satir='Chiller Redundant Supply',
        not_='Çizelgede BB/MSB.%s/04 (1250 A bara) ucundaki DB; soğutma kapasitesi eklenmedi (yalnızca elektrik yükü).' % B)
    yuk('udb3', 'mekanikYuk', f'UDB.{B}.3 (FWU DB - Module-1)', 54.05, 57.5, 19.62, 'dis', satir=f'UDB.{B}.3 (FWU DB - Module-')
    yuk('udb1_yuk', 'genelYuk', f'UDB.{B}.1 yükleri (Equipment UDB)', 42.24, 42.24, 0, 'elektrik', satir=f'UDB.{B}.1 (Equipment UDB)', pdf=(94.16, 94.16, 0),
        not_=('Varsayım: çizelgedeki 94,16 kW (131 A, 160 A giriş) UDB.%s.1\'in alt DB\'leri dahil toplam yüküdür; alt DB\'ler (UDB.%s.4: 28,32 kW, ACD.MMR1.2: 23,6 kW) '
              'ayrıca modellendiği için burada kalan 42,24 kW alındı. Ayrı toplansaydı 160 A MCCB ve UPS.%s.3 (200 kW) aşırı yüklenirdi.' % (B, B, B)))
    yuk('udb2_yuk', 'genelYuk', f'UDB.{B}.2 yükleri (Mechanical UDB)', 39.36, 41.69, 13.76, 'elektrik', satir=f'UDB.{B}.2 (Mechanical UDB)')
    yuk('udb4_yuk', 'genelYuk', f'UDB.{B}.4 yükleri (MDA DB)', 28.32, 30, 9.9, 'elektrik', satir=f'UDB.{B}.4 (MDA DB)')
    # tee besleme ve tap-off (catcher)
    dugum(ref('tf'), 'bara', f'TF-1 ({B} tee besleme)', params=dict(gerilim=V, nominalAkim=2500, girisSayisi=1, cikisSayisi=2),
          not_=f'Çizelge s.{P["tee"]}: TF-1 (BB/{B} → BB/{B}-Sec2). Catcher barasının iki kola ayrıldığı nokta.')
    for i, plx in ((1, 'PL1'), (2, 'PL2')):
        dugum(ref(f'to{i}'), 'kesici', f'TO-{i} ({B}) ACB tap-off → CRP.{plx}.1',
              params=dict(tip='ACB', nominalAkim=2500, kutup='4P', durum='kapali', otomatik='yok', gerilim=V, kesmeKa=70, montaj='ust'),
              not_=f'Çizelge s.{P["tap"]}: TO-{i}, ACB 2500 A, 70 kA; Cbl_SM-{4 + i} ile CRP.{plx}.1 beslenir.')

    # ------------------------------------------------------------------ kaynak tarafı
    hat(f'OG besleme ({B})', 'kablo', ref('grid'), ref('rmu'), 100, 'varsayim', akim=200, veri='varsayim', gerilim=34500,
        kablo_=dict(metin='34,5 kV OG kablo', akim=200, r=0.3, x=0.12), aciklama='şema dışı OG besleme (varsayım)')
    hat(f'OG hat RMU.{B} → TX.{B}', 'kablo', ref('rmu'), ref('tx'), 10, 'varsayim', akim=200, veri='varsayim', gerilim=34500,
        kablo_=dict(metin='34,5 kV OG kablo', akim=200, r=0.3, x=0.12), uzunluk_kaynak='3d', aciklama='OG hat (uzunluk 3D yerleşimden)')
    hat(f'BB/TX.{B}', 'busbar', ref('tx'), ref('msb'), 46, f'{ozet},{kay},{bar}', akim=5000, aciklama='5000 A BUSBAR (4P)',
        hk=kesici(f'ACB MSB.{B} trafo girişi', 'ACB', 5000, 70, kutup='3P', sayfa=f'{kay}',
                  not_=f'Çizelge s.{kay}: TX.{B} sekonder koruması ACB Electronic LSIG 5000 A, 70 kA.'))
    # jeneratör tesisi (varsayım: PL1 düzeni)
    for i in (1, 2):
        hat(f'GEN.{B}.{i} çıkış', 'busbar', ref(f'gen{i}'), ref('sync'), 10, 'varsayim', akim=2500, veri='varsayim', aciklama='jeneratör çıkış hattı (varsayım)',
            k=kesici(f'ACB GEN.{B}.{i} (jeneratör çıkışı)', 'ACB', 2500, 70, veri='varsayim',
                     not_='Varsayım: jeneratör çıkış ACB\'si çizelgede yok; GEN.PL1.x gibi 2500 A (iki jeneratör = 5000 A baraya uyar).'))
    hat(f'BB/GEN.{B}', 'busbar', ref('sync'), ref('msb'), 100, f'{ozet}', akim=5000, aciklama='5000 A BUSBAR (5P)',
        k=kesici(f'ACB GEN.{B} çıkış (5000 A)', 'ACB', 5000, 70, veri='varsayim',
                 not_=f'Varsayım: BB/GEN.{B} başındaki ACB çizelgede yok; bara anma akımı (5000 A) alındı.'),
        hk=kesici(f'ACB MSB.{B} jeneratör girişi', 'ACB', 5000, 70, kutup='3P', veri='varsayim', durum='acik', otomatik='otomatik',
                  not_=f'Varsayım: MSB.{B} jeneratör giriş ACB\'si çizelgede yok; MSB anma akımı (5000 A) alındı. Normalde AÇIK, şebeke/trafo kaybında otomatik kapanır (jeneratör ile trafo paralel çalışmaz; çizelgenin kısa devre hesabı yalnız trafoyu içerir).'))

    # ------------------------------------------------------------------ MSB çıkışları
    BYP = dict(durum='acik', otomatik='otomatik')
    hat(f'BB/MSB.{B}/01', 'busbar', ref('msb'), ref('udp1'), 13, f'{ozet},{bar}', akim=2500, aciklama='2500 A BUSBAR (5P) — UPS bypass hattı',
        k=kesici(f'ACB MSB.{B} → UDP.{B}.1 bypass', 'ACB', 2500, 70, sayfa=f'{bar}', **BYP,
                 not_=f'Çizelge s.{bar}: BB/MSB.{B}/01 (çizelgede BB/MBS.{B}/01), ACB 2500 A, 70 kA. Bakım bypass hattı; normalde AÇIK, UPS arızasında otomatik kapanır (UPS.PL1.x ile aynı mantık).'),
        hk=kesici(f'ACB UDP.{B}.1 bypass girişi', 'ACB', 2500, 70, sayfa=f'{pano}', **BYP,
                  not_=f'Çizelge s.{pano}: UDP.{B}.1 ACB 2500 A, 70 kA. Bypass girişi; normalde AÇIK.'))
    for i, bbn in ((1, 2), (2, 3)):
        hat(f'BB/MSB.{B}/0{bbn}', 'busbar', ref('msb'), ref(f'ups{i}'), 6.5, f'{ozet}', akim=1600, aciklama='1600 A BUSBAR (5P)',
            k=kesici(f'ACB MSB.{B} → UPS.{B}.{i} girişi', 'ACB', 1600, 70, kutup='3P', veri='varsayim',
                     not_=f'Varsayım: BB/MSB.{B}/0{bbn} başındaki şalter çizelgede yok; bara anma akımı (1600 A), 70 kA (MSB Icu) alındı.'))
        hat(f'BB/UPS.{B}.{i}', 'busbar', ref(f'ups{i}'), ref('udp1'), 6.5, f'{ozet}', akim=1600, aciklama='1600 A BUSBAR (5P)',
            hk=kesici(f'ACB UDP.{B}.1 ← UPS.{B}.{i} çıkışı', 'ACB', 1600, 70, veri='varsayim',
                      not_=f'Varsayım: UPS.{B}.{i} çıkış şalteri çizelgede yok; bara anma akımı (1600 A) alındı.'))
    kb95 = lambda: kablo(2, 4, 95, 70)
    hat(f'CBL/MSB.{B}/01', 'kablo', ref('msb'), ref('udp2'), 10, f'{ozet},{kab}', kablo_=kb95(),
        k=kesici(f'MCCB MSB.{B} → UDP.{B}.2 bypass', 'MCCB', 400, 70, sayfa=f'{kab}', **BYP,
                 not_=f'Çizelge s.{kab}: CBL/MSB.{B}/01, MCCB 400 A, 70 kA (Electronic LSI). Bakım bypass hattı; normalde AÇIK, otomatik kapanır.'),
        hk=kesici(f'MCCB UDP.{B}.2 bypass girişi', 'MCCB', 400, 70, sayfa=f'{pano}', **BYP,
                  not_=f'Çizelge s.{pano}: UDP.{B}.2 MCCB 400 A, 70 kA. Bypass girişi; normalde AÇIK.'))
    hat(f'CBL/MSB.{B}/02', 'kablo', ref('msb'), ref('ups3'), 7, f'{ozet}', kablo_=kb95(),
        k=kesici(f'MCCB MSB.{B} → UPS.{B}.3 girişi', 'MCCB', 400, 70, kutup='3P', veri='varsayim',
                 not_=f'Varsayım: CBL/MSB.{B}/02 başındaki MCCB çizelge hesabında yok; CBL/MSB.{B}/01 ile aynı (400 A, 70 kA) alındı.'))
    hat(f'CBL/UPS.{B}.3', 'kablo', ref('ups3'), ref('udp2'), 3, f'{ozet}', kablo_=kb95(),
        hk=kesici(f'MCCB UDP.{B}.2 ← UPS.{B}.3 çıkışı', 'MCCB', 400, 70, veri='varsayim',
                  not_=f'Varsayım: UPS.{B}.3 çıkış şalteri çizelgede yok; UDP.{B}.2 giriş MCCB\'si (400 A) alındı.'))
    hat(f'CBL/MSB.{B}/03', 'kablo', ref('msb'), ref('mmr'), 40, f'{ozet},{kab}', kablo_=kablo(1, 4, 95, 50),
        k=kesici(f'MCCB MSB.{B} → MMR-1 DC Supply', 'MCCB', 200, 70, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/MSB.{B}/03, MCCB 200 A, 70 kA.'))
    hat(f'CBL/MSB.{B}/04', 'kablo', ref('msb'), ref('gaux1'), 100, f'{ozet},{kab}', kablo_=kablo(1, 5, 35),
        k=kesici(f'MCCB MSB.{B} → GEN.{B}.1 Aux.', 'MCCB', 100, 70, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/MSB.{B}/04, MCCB 100 A, 70 kA.'))
    hat(f'CBL/MSB.{B}/05', 'kablo', ref('msb'), ref('gaux2'), 100, f'{ozet},{kab}', kablo_=kablo(1, 5, 35),
        k=kesici(f'MCCB MSB.{B} → GEN.{B}.2 Aux.', 'MCCB', 100, 70, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/MSB.{B}/05, MCCB 100 A, 70 kA.'))
    hat(f'BB/MSB.{B}/04', 'busbar', ref('msb'), ref('chiller'), 3, f'{bar},{P["db"]}', akim=1250, aciklama='1250 A BUSBAR — Chiller Redundant Supply',
        k=kesici(f'ACB MSB.{B} → Chiller Redundant Supply', 'ACB', 1250, 70, sayfa=f'{bar}',
                 not_=f'Çizelge s.{bar}: BB/MSB.{B}/04 (MSB → Chiller Redundant Supply), ACB 1250 A, 70 kA. Not: bu bara özet sayfasında (s.{ozet}) listelenmemiş, hesap sayfasında vardır.'))

    # ------------------------------------------------------------------ UDP.x.2 ve UDB.x.1 çıkışları
    hat(f'CBL/UDP.{B}.2/01', 'kablo', ref('udp2'), ref('udb1'), 15, f'{ozet},{kab}', kablo_=kablo(1, 4, 70, 25),
        k=kesici(f'MCCB UDP.{B}.2 → UDB.{B}.1', 'MCCB', 160, 70, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/UDP.{B}.2/01, MCCB 160 A, 70 kA.'))
    hat(f'CBL/UDP.{B}.2/02', 'kablo', ref('udp2'), ref('udb2'), 15, f'{ozet},{kab}', kablo_=kablo(1, 5, 16),
        k=kesici(f'MCCB UDP.{B}.2 → UDB.{B}.2', 'MCCB', 63, 50, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/UDP.{B}.2/02, MCCB 63 A, 50 kA.'))
    hat(f'CBL/UDP.{B}.2/03', 'kablo', ref('udp2'), ref('udb3'), 130, f'{ozet},{kab}', kablo_=kablo(1, 4, 35, 25),
        k=kesici(f'MCCB UDP.{B}.2 → UDB.{B}.3', 'MCCB', 80, 50, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/UDP.{B}.2/03, MCCB 80 A, 50 kA.'))
    hat(f'CBL/UDB.{B}.1/01', 'kablo', ref('udb1'), ref('udb4'), 30, f'{ozet},{kab}', kablo_=kablo(1, 5, 16),
        k=kesici(f'MCCB UDB.{B}.1 → UDB.{B}.4', 'MCCB', 63, 50, sayfa=f'{kab}', not_=f'Çizelge s.{kab}: CBL/UDB.{B}.1/01, MCCB 63 A, 50 kA.'))
    hat(f'CBL/UDB.{B}.1/02', 'kablo', ref('udb1'), 'ACD.MMR1.2', 30, f'{ozet},{kab}', kablo_=kablo(1, 5, 16),
        k=kesici(f'MCCB UDB.{B}.1 → ACD.MMR1.2', 'MCCB', 63, 50, sayfa=f'{kab}',
                 not_=f'Çizelge s.{kab}: CBL/UDB.{B}.1/02, MCCB 63 A, 50 kA.' + (' Not: C2 sayfasında da "ACD.MMR1.2" yazıyor (C1 sayfasından kopya olabilir); çizelgeye uyularak aynı pano iki bloktan beslendi.' if B == 'C2' else '')))
    for rf, src, ad, amp in (('udb1_yuk', 'udb1', 'UDB.%s.1 yükü', 160), ('udb2_yuk', 'udb2', 'UDB.%s.2 yükü', 63), ('udb4_yuk', 'udb4', 'UDB.%s.4 yükü', 63)):
        hat(ad % B, 'busbar', ref(src), ref(rf), 2, 'varsayim', akim=amp, veri='varsayim', aciklama='pano yükü (çizelge s.%d)' % P['db'])

    # ------------------------------------------------------------------ catcher (BB/Cx → TF-1 → TO-1/TO-2 → CRP.PL1.1 / CRP.PL2.1)
    hat(f'BB/{B}', 'busbar', ref('udp1'), ref('tf'), 61, f'{bar}', akim=2500, aciklama='2500 A BUSBAR — catcher barası',
        k=kesici(f'ACB UDP.{B}.1 → catcher (BB/{B})', 'ACB', 2500, 70, sayfa=f'{bar}', not_=f'Çizelge s.{bar}: BB/{B} (UDP.{B}.1 → TF-1), ACB 2500 A, 70 kA.'))
    for i, plx in ((1, 'PL1'), (2, 'PL2')):
        g = f'catcher-{B}-{plx}'
        hat(f'BB/{B}-Sec{i + 1}', 'busbar', ref('tf'), ref(f'to{i}'), 64 if i == 1 else 67, f'{bar}', akim=2500, grup=g, aciklama='2500 A BUSBAR (TF-1 → TO-%d)' % i)
        hat(f'Cbl_SM-{4 + i} ({B})', 'kablo', ref(f'to{i}'), f'CRP.{plx}.1:c{N}', 10, f'{kab}', grup=g, aciklama=f'tek damar, ayrı 1000 mm² CPC; akım kapasitesi = tap-off ACB 2500 A (kablo kapasitesi çizelgede yok) (TO-{i} → CRP.{plx}.1)',
            kablo_=dict(paralel=10, damar=4, kesit=1000, pe=1000, metin='10x(4x1000)+1000 mm² Cu XLPE', akim=2500, r=0.0018, x=0.007))

# ---------------------------------------------------------------------------------- catcher tarafı (PL1 / PL2 CRP panoları)
# CRP.PLx.1: C1 ve C2 catcher barasından ("Catcher 01/02" ACB'leri) beslenir; çıkışı BB/CRP.PLx.1 ile STS B girişlerine gider.
# Şema dışı yer tutucu kaynaklar ve 0 kW "catcher barası" yükleri bu gerçek bağlantıyla değiştirilir.
for plx in ('PL1', 'PL2'):
    dugum(f'CRP.{plx}.1', 'mdb', f'CRP.{plx}.1', alias=[f'CRP.{plx}.1'], olustur=False)
    dugum(f'CRP.{plx}.1:in', 'kesici', f'ACB CRP.{plx}.1 girişi', alias=[f'ACB CRP.{plx}.1 girişi'], olustur=False, params=dict(kesmeKa=70))
    dugum(f'CRP.{plx}.1:bus', 'bara', f'BB/CRP.{plx}.1 (catcher barası)', alias=[f'BB/CRP.{plx}.1 (catcher barası)'], olustur=False)
    for no in (1, 2):
        dugum(f'CRP.{plx}.1:c{no}', 'kesici', f'ACB CRP.{plx}.1 → Catcher 0{no}', alias=[f'ACB CRP.{plx}.1 → Catcher 0{no}'], olustur=False,
              params=dict(montaj='alt', kesmeKa=70))  # artık giriş şalteri: 3D'de CRP panosuna oturur
    g = f'crp-{plx}'
    for no in (1, 2):
        hat(f'CRP.{plx}.1 ← Catcher 0{no}', 'busbar', f'CRP.{plx}.1:c{no}', f'CRP.{plx}.1', 2, 'varsayim', akim=2500, veri='varsayim', grup=g,
            aciklama=f'Catcher 0{no} girişi (C{no} bloğu)')
    hat(f'CRP.{plx}.1 çıkışı', 'busbar', f'CRP.{plx}.1', f'CRP.{plx}.1:in', 2, 'varsayim', akim=2500, veri='varsayim', grup=g, aciklama='CRP çıkışı → catcher barası')
    hat(f'BB/CRP.{plx}.1', 'busbar', f'CRP.{plx}.1:in', f'CRP.{plx}.1:bus', 20, 'varsayim', akim=2500, veri='varsayim', grup=g, aciklama='2500 A BUSBAR (5P)')
    # yer tutucular: şema dışı kaynaklar ve 0 kW catcher yükleri (PL2 kopyasında adın başına "PL2 " eklenmiştir)
    temizle['dugumler'] += [
        dict(adlar=[f'CRP.{plx}.1 beslemesi (şema dışı)'], tur='sebeke', grup=g),
        dict(adlar=[f'Catcher kaynağı (BB/CRP.{plx}.1, şema dışı)'], tur='sebeke', grup=g),
        dict(adlar=['Busbar Catcher 01 (şema dışı bağlantı)', f'{plx} Busbar Catcher 01 (şema dışı bağlantı)'], tur='genelYuk', grup=g),
        dict(adlar=['Busbar Catcher 02 (şema dışı bağlantı)', f'{plx} Busbar Catcher 02 (şema dışı bağlantı)'], tur='genelYuk', grup=g),
    ]
    temizle['hatlar'] += [
        dict(kaynak=f'CRP.{plx}.1', hedef=f'CRP.{plx}.1:c1', grup=g), dict(kaynak=f'CRP.{plx}.1', hedef=f'CRP.{plx}.1:c2', grup=g),
        dict(kaynak=f'CRP.{plx}.1:in', hedef=f'CRP.{plx}.1', grup=g),
    ]

# ACD.MMR1.2: iki bloktan beslenen ortak pano (çizelge s.27/34)
dugum('ACD.MMR1.2', 'dagitimPanosu', 'ACD.MMR1.2', alias=['ACD.MMR1.2'], params=dict(gerilim=V, nominalAkim=63))
dugum('ACD.MMR1.2:yuk', 'genelYuk', 'ACD.MMR1.2 yükü', alias=['ACD.MMR1.2 yükü'], params=dict(gerilim=V),
      varsayilan=dict(kuruluKw=23.6, pf=0.944, df=1, kategori='Mekanik', isiKonum='elektrik'),
      cizelge=dict(sayfa=29, satir='ACD.MMR1.2', kw=23.6, kvar=8.25, kva=25),
      not_='Çizelge s.29: 23,6 kW / 8,25 kVAr / 25 kVA. Her iki bloğun sayfasında aynı satır var; tek yük sayıldı.')
hatlar.append(dict(ad='ACD.MMR1.2 yükü', tip='busbar', kaynak='ACD.MMR1.2', hedef='ACD.MMR1.2:yuk', uzunluk=2, sayfa='varsayim', veri='varsayim', akim=63, aciklama='pano yükü (çizelge s.29)'))

# Çözümlenemeyen ref'ler (blok dışı sabit adlar) için ACD kaydı yukarıda; hat 'kaynak/hedef' ref eşlemesi: 'C1:msb' gibi blok ön ekli
# veya sabit ref ('ACD.MMR1.2', 'CRP.PL1.1:c1').
# "CRP.PLx.1:cN" hedefi blok bağımlıdır: C1 → Catcher 01, C2 → Catcher 02 (yukarıda f'CRP.{plx}.1:c{N}' ile yazıldı).

spec = dict(
    surum=1,
    ad='HDC02 C1/C2 — LV Cable Schedule (HDC02-ARP-RP-E-DD-ZZ-ZZ-POWR-7002 R00)',
    kaynak='HDC02-ARP-RP-E-DD-ZZ-ZZ-POWR-7002 - LV Cable Schedule, R00 08 May 2026',
    dugumler=dugumler,
    hatlar=hatlar,
    temizle=temizle,
)

# ---------------------------------------------------------------------------------- PDF karşılaştırması
def kontrol(pdf_yolu):
    """Her çizelge kaynaklı değeri PDF metnindeki ilgili satırla karşılaştırır. (hata listesi, doğrulanan alan sayısı, atlananlar)"""
    import pdfplumber
    with pdfplumber.open(pdf_yolu) as pdf:
        sayfa = {i: (p.extract_text() or '') for i, p in enumerate(pdf.pages, 1)}
    pm = {b: p for b, _, p in BLOKLAR}
    hata, ok, atla = [], [0], []
    num = lambda t: float(t.replace(',', '.'))

    def satir(metin, bas):
        for ln in metin.split('\n'):
            if ln.startswith(bas):
                return ln
        return None

    def esit(blok, ad, alan, pdf_deger, spec_deger):
        if abs(float(pdf_deger) - float(spec_deger)) > 1e-9:
            hata.append(f'{blok} {ad}: {alan} PDF={pdf_deger} ≠ spec={spec_deger}')
        else:
            ok[0] += 1

    for h in hatlar:
        blok = h.get('blok', '')
        if blok not in pm:
            continue
        P = pm[blok]
        ad = h['ad']
        ozet, kab, bar, pano, kay, tap = (sayfa[P[k]] for k in ('ozet', 'kablo', 'bara', 'pano', 'kaynak', 'tap'))
        # --- 1) kablo/bara özeti (kaynak 'cizelge' ve ad PDF'te geçenler)
        if h['veri'] == 'cizelge' and h['tip'] == 'kablo' and ad.startswith('CBL/'):
            ln = satir(ozet, ad + ' ')
            m = ln and re.search(r'(\d+) x 1 x (\d)c (\d+) (\d+) (?:Separate|Integral) 31 - .*?Touching (\d+) (.+)$', ln)
            if not m:
                hata.append(f'{blok} {ad}: özet satırı bulunamadı (s.{P["ozet"]})')
            else:
                k = h['kablo']
                par, cores, mm2, pe, uz, uclar = m.groups()
                esit(blok, ad, 'paralel kablo', par, k['paralel'])
                esit(blok, ad, 'damar sayısı', cores, k['damar'])
                esit(blok, ad, 'faz kesiti', mm2, k['kesit'])
                if int(cores) == 4:
                    esit(blok, ad, 'PE kesiti', pe, k.get('pe', 0))
                esit(blok, ad, 'uzunluk', uz, h['uzunluk'])
                # uç adları: kaynak ve hedef etiketi satır sonunda geçmeli
                for yon in ('kaynak', 'hedef'):
                    d = next(x for x in dugumler if x['ref'] == h[yon])
                    tok = (d.get('alias') or [d['ad']])[0].split(' ')[0].replace('Loads', '')
                    if d['tur'] == 'itYuku':
                        tok = 'MMR-1'
                    if d['tur'] == 'mekanikYuk' and 'Aux' in d['ad']:
                        tok = f'Generator {blok} Auxiliary'
                    if tok.replace(' ', '') not in uclar.replace(' ', '') and tok.split(' ')[0] not in uclar:
                        hata.append(f'{blok} {ad}: {yon} ucu "{tok}" satır sonunda yok: {uclar}')
                    else:
                        ok[0] += 1
        elif h['veri'] == 'cizelge' and h['tip'] == 'busbar' and ad.startswith('BB/'):
            pdf_ad = ad.replace(f'BB/MSB.{blok}/01', f'BB/MBS.{blok}/01')  # hesap sayfasında "MBS" yazım hatası
            ln = satir(ozet, ad + ' ')
            if ln:
                m = re.search(r'HPB (\d) (\d+) Aluminium \S+ Horizontal ([\d,]+) ', ln)
                esit(blok, ad, 'bara anma akımı', m.group(2), h['akim'])
                esit(blok, ad, 'bara uzunluğu', num(m.group(3)), h['uzunluk'])
            else:
                ln = satir(bar, pdf_ad + ' ')
                m = ln and re.search(r'Aluminium (\d) (\d+) ([\d.]+) ', ln)
                if not m:
                    hata.append(f'{blok} {ad}: ne özet (s.{P["ozet"]}) ne hesap (s.{P["bara"]}) sayfasında bulunamadı')
                else:
                    esit(blok, ad, 'bara anma akımı (hesap)', m.group(2), h['akim'])
                    esit(blok, ad, 'bara uzunluğu (hesap)', m.group(3), h['uzunluk'])
        elif h['veri'] == 'cizelge' and ad.startswith('Cbl_SM'):
            ln = satir(kab, ad.split(' (')[0] + ' ')
            m = ln and re.search(r' (\d+) (\d+) x (\d) x 1c (\d+) ', ln)
            if not m:
                hata.append(f'{blok} {ad}: kablo satırı bulunamadı (s.{P["kablo"]})')
            else:
                k = h['kablo']
                esit(blok, ad, 'uzunluk', m.group(1), h['uzunluk'])
                esit(blok, ad, 'paralel', m.group(2), k['paralel'])
                esit(blok, ad, 'kesit', m.group(4), k['kesit'])
        # --- 2) koruma cihazları
        for anahtar in ('kesici', 'hedefKesici'):
            kk = h.get(anahtar)
            if not kk or kk['veri'] != 'cizelge':
                continue
            tip = kk['tip']
            sp = int(kk['sayfa'])
            if sp == P['kablo']:  # kablo hesabı: kaynak uç cihazı
                ln = satir(kab, ad + ' ')
                m = ln and re.search(rf'{tip} Generic, {tip}, (\d+)kA(?: Icu)?, (\d+) (\d+) ', ln)
                if not m:
                    hata.append(f'{blok} {ad}: koruma cihazı satırı bulunamadı (s.{sp})')
                else:
                    esit(blok, ad, f'{anahtar} anma akımı', m.group(2), kk['akim'])
                    esit(blok, ad, f'{anahtar} Icu', m.group(3), kk['icu'])
            elif sp == P['bara']:  # bara hesabı: satır sonunda cihaz tipi, anma, Icu
                pdf_ad = ad.replace(f'BB/MSB.{blok}/01', f'BB/MBS.{blok}/01')
                ln = satir(bar, pdf_ad + ' ')
                m = ln and re.search(rf'{tip} (\d+) (\d+)\s*$', ln)
                if not m:
                    hata.append(f'{blok} {ad}: bara cihaz satırı bulunamadı (s.{sp})')
                else:
                    esit(blok, ad, f'{anahtar} anma akımı', m.group(1), kk['akim'])
                    esit(blok, ad, f'{anahtar} Icu', m.group(2), kk['icu'])
            elif sp == P['pano']:  # pano tablosu: "UDP.C1.1 415 ACB ACB 70kA Icu Electronic LSI 2500 70"
                hedef = next(x for x in dugumler if x['ref'] == h['hedef'])
                pano_ad = (hedef.get('alias') or [hedef['ad']])[0]
                ln = satir(sayfa[P['pano']], pano_ad + ' ')
                m = ln and re.search(rf'415 {tip} .*? (\d+) (\d+)\s*$', ln)
                if not m:
                    hata.append(f'{blok} {ad}: pano satırı "{pano_ad}" bulunamadı (s.{sp})')
                else:
                    esit(blok, ad, f'{anahtar} anma akımı', m.group(1), kk['akim'])
                    esit(blok, ad, f'{anahtar} Icu', m.group(2), kk['icu'])
            elif sp == P['kaynak']:  # kaynak tablosu: "TX.C1 ... 415 55.78 1240.00 3150.00 7 ACB Electronic LSIG 5000 70 ..."
                ln = satir(kay, f'TX.{blok} ')
                m = ln and re.search(rf' 415 ([\d.]+) ([\d.]+) ([\d.]+) (\d+) {tip} Electronic LSIG? (\d+) (\d+)\s', ln)
                if not m:
                    hata.append(f'{blok} {ad}: trafo satırı bulunamadı (s.{sp})')
                else:
                    grid = next(x for x in dugumler if x['ref'] == f'{blok}:grid')
                    tx = next(x for x in dugumler if x['ref'] == f'{blok}:tx')
                    esit(blok, ad, 'primer kısa devre gücü MVA', m.group(2), grid['params']['kisaDevreMva'])
                    esit(blok, ad, 'trafo kVA', m.group(3), tx['params']['nominalKva'])
                    esit(blok, ad, 'trafo empedansı %', m.group(4), tx['params']['uk'])
                    esit(blok, ad, f'{anahtar} anma akımı', m.group(5), kk['akim'])
                    esit(blok, ad, f'{anahtar} Icu', m.group(6), kk['icu'])
            else:
                atla.append(f'{blok} {ad}: {anahtar} sayfa {sp} için denetim yok')
    # --- 3) tap-off ve tee
    for blok, P in pm.items():
        tap = sayfa[P['tap']]
        for i, plx in ((1, 'PL1'), (2, 'PL2')):
            ln = satir(tap, f'TO-{i} ')
            m = ln and re.search(rf'BB/{blok}-Sec{i + 1} Cbl_SM-{4 + i} Cbl_SM-{4 + i} CRP\.{plx}\.1 ACB (\d+) (\d+)', ln)
            if not m:
                hata.append(f'{blok} TO-{i}: tap-off satırı bulunamadı (s.{P["tap"]})')
            else:
                esit(blok, f'TO-{i}', 'tap-off ACB anma akımı', m.group(1), 2500)
                esit(blok, f'TO-{i}', 'tap-off Icu', m.group(2), 70)
        if f'TF-1 BB/{blok} BB/{blok}-Sec2' not in sayfa[P['tee']]:
            hata.append(f'{blok}: TF-1 tee satırı bulunamadı (s.{P["tee"]})')
        else:
            ok[0] += 1
    # --- 4) yükler (Distribution Board tablosu)
    for d in dugumler:
        c = d.get('cizelge')
        if not c:
            continue
        blok = next((b for b in pm if f'.{b}' in d['ad'] or f'({b}' in d['ad']), '')
        sp = c['sayfa'] if not blok else pm[blok]['db']
        ln = satir(sayfa[sp], c['satir'])
        m = ln and re.search(r' ([\d.]+) ([\d.]+) ([\d.]+)\s*$', ln)
        if not m:
            hata.append(f'{d["ref"]}: DB satırı "{c["satir"]}" bulunamadı (s.{sp})')
            continue
        esit(blok, d['ad'], 'kW', m.group(1), c['kw'])
        esit(blok, d['ad'], 'kVAr', m.group(2), c['kvar'])
        esit(blok, d['ad'], 'kVA', m.group(3), c['kva'])
    return hata, ok[0], atla


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default='')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'examples', 'hdc02-c1c2.hatlar.json'))
    a = ap.parse_args()
    if a.pdf:
        hata, ok, atla = kontrol(a.pdf)
        print(f'PDF karşılaştırması: {ok} alan doğrulandı, {len(hata)} sorun, {len(atla)} atlandı')
        for h in hata:
            print('  ✗', h)
        for h in atla:
            print('  –', h)
        if hata:
            sys.exit(1)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=1)
    print(f'{len(dugumler)} düğüm, {len(hatlar)} hat → {os.path.normpath(a.out)}')
