import type { EquipmentType, Params } from '../model/types'

/**
 * Hazır ekipman kataloğu. Kayıtlar üretici-bağımsız TİPİK değerlerdir (gerçek bir üretici modelinin
 * katalog verisi değildir); tek tıkla şemaya eklenir ve özellikler panelinden gerçek model verisiyle değiştirilir.
 * Kullanıcı kataloğu (kendi kayıtları) tarayıcıda saklanır.
 */
export interface CatalogEntry {
  id: string
  ad: string
  type: EquipmentType
  /** Tipin varsayılanlarının üzerine yazılacak parametreler. */
  params: Params
  aciklama: string
  /** Kullanıcının kendi kaydı (silinebilir). */
  user?: boolean
}

const e = (id: string, ad: string, type: EquipmentType, params: Params, aciklama: string): CatalogEntry => ({ id, ad, type, params, aciklama })

// Trafo: [kVA, boşta kW, yük kW] — tipik yağlı/kuru tip değerleri; uk %6.
const TRAFOS: [number, number, number][] = [
  [630, 0.8, 6.5],
  [1000, 1.1, 10],
  [1600, 1.7, 14],
  [2500, 2.6, 22],
  [3150, 3.2, 27],
]
// Jeneratör kVA → tank (L, ≈ 8 saat tam yük).
const GENS: [number, number][] = [
  [500, 1000],
  [800, 1600],
  [1250, 2500],
  [1600, 3200],
  [2000, 4000],
  [2500, 5000],
]
const UPSS = [200, 300, 500, 800, 1000, 1200]
// ACB: [A, kA]; MCCB: [A, kA]
const ACBS: [number, number][] = [
  [1600, 65],
  [2500, 65],
  [3200, 75],
  [4000, 85],
  [6300, 100],
]
const MCCBS: [number, number][] = [
  [250, 36],
  [400, 50],
  [630, 50],
  [800, 65],
  [1250, 65],
]
const CHILLERS: [number, number][] = [
  [500, 120],
  [1000, 220],
  [1500, 320],
  [2000, 420],
]
const CRAHS: [number, number][] = [
  [40, 7],
  [80, 12],
  [120, 18],
  [160, 24],
]

export const BUILTIN_CATALOG: CatalogEntry[] = [
  ...TRAFOS.map(([kva, p0, pk]) =>
    e(`trafo-${kva}`, `Trafo ${kva} kVA`, 'trafo', { nominalKva: kva, primerGerilim: 34500, sekonderGerilim: 400, uk: 6, bostaKayip: p0, yukKayip: pk }, `Tipik ${kva} kVA dağıtım trafosu (uk %6, 34,5 kV / 0,4 kV).`),
  ),
  ...GENS.map(([kva, tank]) =>
    e(`jen-${kva}`, `Dizel jeneratör ${kva} kVA`, 'jenerator', { nominalKva: kva, gerilim: 400, pf: 0.8, xd: 15, yakitL: tank, yakitKullanilabilir: 90 }, `Tipik ${kva} kVA dizel jeneratör (cos φ 0,8, Xd″ %15, ≈ 8 sa tank).`),
  ),
  ...UPSS.map((kva) => e(`ups-${kva}`, `UPS ${kva} kVA`, 'ups', { nominalKva: kva, nominalKw: Math.round(kva * 0.9), bataryaDk: 10 }, `Tipik çift dönüşümlü UPS, ${kva} kVA / ${Math.round(kva * 0.9)} kW, 10 dk batarya.`)),
  ...ACBS.map(([a, ka]) => e(`acb-${a}`, `ACB ${a} A`, 'kesici', { tip: 'ACB', nominalAkim: a, kutup: '4P', kesmeKa: ka }, `Tipik hava devre kesici, ${a} A, Icu ${ka} kA.`)),
  ...MCCBS.map(([a, ka]) => e(`mccb-${a}`, `MCCB ${a} A`, 'kesici', { tip: 'MCCB', nominalAkim: a, kutup: '3P', kesmeKa: ka, isdKat: 5, iiKat: 10 }, `Tipik kompakt kesici, ${a} A, Icu ${ka} kA.`)),
  ...CHILLERS.map(([tr, kw]) => e(`chiller-${tr}`, `Chiller ${tr} kW`, 'chiller', { sogutmaKw: tr, kuruluKw: kw }, `Tipik soğutma grubu: ${tr} kW soğutma, ${kw} kW elektrik girişi (COP ≈ ${(tr / kw).toFixed(1)}).`)),
  ...CRAHS.map(([c, kw]) => e(`crah-${c}`, `CRAH ${c} kW`, 'crah', { sogutmaKw: c, kuruluKw: kw }, `Tipik soğuk sulu klima: ${c} kW soğutma, ${kw} kW fan gücü.`)),
  e('crac-90', 'CRAC 90 kW', 'crac', { sogutmaKw: 90, kuruluKw: 30 }, 'Tipik DX klima: 90 kW soğutma, 30 kW elektrik.'),
  e('fanwall-250', 'Fan wall 250 kW', 'fanwall', { sogutmaKw: 250, kuruluKw: 25 }, 'Tipik fan wall ünitesi.'),
  e('pompa-30', 'Soğuk su pompası 30 kW', 'pompa', { kuruluKw: 30 }, 'Tipik soğuk su pompası.'),
  e('kule-22', 'Soğutma kulesi 22 kW', 'sogutmaKulesi', { kuruluKw: 22 }, 'Tipik açık devre soğutma kulesi fanı.'),
  e('rack-80', 'Rack sırası 80 kW', 'rack', { kuruluKw: 80 }, 'Yüksek yoğunluklu rack sırası.'),
  e('pdu-250', 'PDU 250 A', 'pdu', { nominalAkim: 250 }, 'Tipik izolasyon trafolu olmayan dağıtım ünitesi.'),
  e('mdb-4000', 'Ana dağıtım panosu 4000 A', 'mdb', { nominalAkim: 4000 }, 'Tipik AG ana dağıtım panosu.'),
]

const KEY = 'dcalculator:userCatalog'

export function loadUserCatalog(): CatalogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.id === 'string' && typeof r.ad === 'string' && typeof r.type === 'string' && r.params && typeof r.params === 'object')
      .map((r) => ({ id: r.id, ad: r.ad, type: r.type as EquipmentType, params: r.params as Params, aciklama: typeof r.aciklama === 'string' ? r.aciklama : '', user: true }))
  } catch {
    return []
  }
}

export function saveUserCatalog(list: CatalogEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ id, ad, type, params, aciklama }) => ({ id, ad, type, params, aciklama }))))
  } catch {
    /* depolama kapalı: kayıt yapılamaz */
  }
}
