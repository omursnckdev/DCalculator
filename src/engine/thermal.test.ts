import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze, upsEfficiency } from './analyze'
import { KW_PER_TR, kwToTr } from './thermal'

const portUse = new Map<string, number>()
const nextPort = (key: string): number => {
  const n = portUse.get(key) ?? 0
  portUse.set(key, n + 1)
  return n
}

let seq = 0
function node(id: string, type: EquipmentType, params: Params = {}): ProjectNode {
  portUse.delete(`${id}:in`)
  portUse.delete(`${id}:out`)
  return { id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++ * 10, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...params } }
}
function edge(source: string, target: string, over: Partial<ProjectEdge> = {}): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 10, akimKapasitesi: 1e6,
    r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali',
    ad: '',
    aciklama: '',
    kaynakPort: nextPort(`${source}:out`), hedefPort: nextPort(`${target}:in`), ...over,
  }
}

/**
 * ELLE HESAPLANMIŞ ÖRNEK (tüm yükler pf = 1, UPS giriş pf = 1, hatlarda R = X = 0):
 *
 *  Şebeke ─ Trafo(2000 kVA; P0 = 2 kW, Pk = 16 kW, uk = %6) ─ MDB ─┬─ UPS(800 kVA / 800 kW, eğri) ─ IT 500 kW
 *                                                                  ├─ CRAH 50 kW   (ısı: salon)
 *                                                                  └─ Chiller 300 kW (ısı: dış ortam)
 *
 *  UPS yük oranı x = 500/800 = 0,625 → η = 96,0 + (96,5 − 96,0)·(0,625 − 0,5)/0,25 = %96,25
 *  UPS girişi = 500 / 0,9625 = 519,4805 kW   → kayıp = 19,4805 kW
 *  MDB (= trafo çıkışı) = 519,4805 + 50 + 300 = 869,4805 kW (= kVA, Q = 0)
 *  Trafo yük oranı = 869,4805 / 2000 = 0,43474
 *    P kaybı = 2 + 16·0,43474² = 5,02399 kW      Q kaybı = 0,06·2000·0,43474² = 22,6799 kvar
 *  Kaynaktan çekilen = 869,4805 + 5,02399 = 874,5045 kW    S = √(874,5045² + 22,6799²) = 874,7986 kVA
 *  PUE = 874,5045 / 500 = 1,74901
 *  Isı: salon = 500 + 50 = 550 kW (156,383 TR); elektrik odası = 19,4805 + 5,02399 = 24,5045 kW; dış = 300 kW
 */
function reference(over: { upsMode?: string } = {}) {
  const nodes = [
    node('grid', 'sebeke'),
    node('tr', 'trafo', { nominalKva: 2000, primerGerilim: 34500, sekonderGerilim: 400, uk: 6, bostaKayip: 2, yukKayip: 16 }),
    node('mdb', 'mdb'),
    node('ups', 'ups', {
      nominalKva: 800, nominalKw: 800, girisPf: 1, verimModu: over.upsMode ?? 'egri',
      verim25: 94, verim50: 96, verim75: 96.5, verim100: 96,
    }),
    node('it', 'itYuku', { kuruluKw: 500, pf: 1, df: 1 }),
    node('crah', 'mekanikYuk', { kuruluKw: 50, pf: 1, df: 1, isiKonum: 'salon' }),
    node('chiller', 'mekanikYuk', { kuruluKw: 300, pf: 1, df: 1, isiKonum: 'dis' }),
  ]
  const edges = [
    edge('grid', 'tr', { gerilim: 34500 }),
    edge('tr', 'mdb'),
    edge('mdb', 'ups'),
    edge('ups', 'it'),
    edge('mdb', 'crah'),
    edge('mdb', 'chiller'),
  ]
  return { nodes, edges }
}

describe('UPS verim eğrisi', () => {
  const ups = node('u', 'ups', { verimModu: 'egri', verim25: 94, verim50: 96, verim75: 96.5, verim100: 96 })
  it.each([
    [0.1, 0.94], // %25 altı: ilk nokta sabit
    [0.25, 0.94],
    [0.375, 0.95], // 94 ile 96 arası orta nokta
    [0.5, 0.96],
    [0.625, 0.9625],
    [0.75, 0.965],
    [0.875, 0.9625],
    [1, 0.96],
    [1.3, 0.96], // %100 üstü: son nokta sabit
  ])('x = %f → η = %f', (x, eta) => {
    expect(upsEfficiency(ups, x)).toBeCloseTo(eta, 10)
  })

  it('sabit modda yük oranından bağımsızdır', () => {
    const u = node('u', 'ups', { verimModu: 'sabit', verim: 95 })
    expect(upsEfficiency(u, 0.2)).toBeCloseTo(0.95, 10)
    expect(upsEfficiency(u, 0.9)).toBeCloseTo(0.95, 10)
  })
})

describe('Faz 3: kayıplar, ısıl yük, PUE (elle doğrulanmış örnek)', () => {
  const a = analyze(reference())

  it('UPS eğri verimi ve kaybı', () => {
    expect(a.nodes.ups.inputKw).toBeCloseTo(519.4805, 3)
    expect(a.nodes.ups.ownLossKw).toBeCloseTo(19.4805, 3)
  })

  it('trafo kaybı: boşta + yük²', () => {
    expect(a.nodes.mdb.totalKw).toBeCloseTo(869.4805, 3)
    expect(a.nodes.tr.ownLossKw).toBeCloseTo(5.02399, 4)
    // Trafo çıkış doluluğu kayıpla değişmez
    expect(a.nodes.tr.loadingPct).toBeCloseTo((869.4805 / 2000) * 100, 3)
  })

  it('kaynaktan çekilen güç ve kVA (trafo reaktif kaybı dahil)', () => {
    expect(a.totals.totalKw).toBeCloseTo(874.5045, 3)
    expect(a.totals.kva).toBeCloseTo(874.7986, 3)
    expect(a.totals.itKw).toBeCloseTo(500, 6)
    expect(a.totals.mechKw).toBeCloseTo(350, 6)
    expect(a.totals.lossKw).toBeCloseTo(24.5045, 3)
  })

  it('PUE = toplam / IT', () => {
    expect(a.pue).toBeCloseTo(1.74901, 5)
  })

  it('mekân bazında ısıl yük', () => {
    expect(a.heat.salonKw).toBeCloseTo(550, 6)
    expect(a.heat.elektrikKw).toBeCloseTo(24.5045, 3)
    expect(a.heat.disKw).toBeCloseTo(300, 6)
    expect(kwToTr(a.heat.salonKw)).toBeCloseTo(156.383, 3)
  })

  it('kayıp dağılımı', () => {
    expect(a.losses.upsKw).toBeCloseTo(19.4805, 3)
    expect(a.losses.trafoKw).toBeCloseTo(5.02399, 4)
    expect(a.losses.lineKw).toBeCloseTo(0, 9)
  })

  it('enerji korunumu: toplam ısı = çekilen güç', () => {
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('sabit modda eğri uygulanmaz', () => {
    const f = reference({ upsMode: 'sabit' })
    f.nodes[3].params.verim = 96
    const r = analyze(f)
    expect(r.nodes.ups.inputKw).toBeCloseTo(500 / 0.96, 6)
  })

  it('1 TR = 3,517 kW', () => {
    expect(KW_PER_TR).toBe(3.517)
    expect(kwToTr(3.517)).toBeCloseTo(1, 12)
  })
})

describe('kablo / busbar kaybı', () => {
  // 100 kW, pf 1, 400 V: I = 144,3376 A; 3·I²·R·L = 3 · 20833,33 · 0,2 Ω/km · 0,1 km = 1250 W
  const make = (konum: 'salon' | 'elektrik' | 'dis') => ({
    nodes: [node('g', 'sebeke', { gerilim: 400 }), node('p', 'dagitimPanosu'), node('l', 'genelYuk', { kuruluKw: 100, pf: 1, df: 1, isiKonum: 'salon' })],
    edges: [edge('g', 'p'), edge('p', 'l', { uzunluk: 100, r: 0.2, x: 0, isiKonum: konum })],
  })

  it('I²R kaybı yukarı doğru toplanır', () => {
    const a = analyze(make('elektrik'))
    expect(a.edges['p>l'].lossKw).toBeCloseTo(1.25, 6)
    expect(a.nodes.p.totalKw).toBeCloseTo(101.25, 6)
    expect(a.totals.totalKw).toBeCloseTo(101.25, 6)
    expect(a.losses.lineKw).toBeCloseTo(1.25, 6)
  })

  it.each(['salon', 'elektrik', 'dis'] as const)('kayıp ısısı %s mekânına yazılır', (loc) => {
    const a = analyze(make(loc))
    const room = { salon: a.heat.salonKw, elektrik: a.heat.elektrikKw, dis: a.heat.disKw }
    // yük (100 kW) salona; hat kaybı seçilen mekâna
    expect(room[loc]).toBeCloseTo(loc === 'salon' ? 101.25 : 1.25, 6)
    expect(a.heat.totalKw).toBeCloseTo(101.25, 6)
  })

  it('reaktif hat kaybı toplam kVA\'ya girer', () => {
    const f = make('elektrik')
    f.edges[1].x = 0.1 // Q kaybı = 3·I²·X·L = 0,625 kvar
    const a = analyze(f)
    expect(a.edges['p>l'].lossKvar).toBeCloseTo(0.625, 6)
    expect(a.totals.kva).toBeCloseTo(Math.hypot(101.25, 0.625), 6)
  })
})

describe('eşzamanlılık (diversity)', () => {
  // MDB'ye bağlı iki panonun toplam talebi 1000 kW; MDB diversity = 0,8 → 800 kW
  const build = (div: number) => ({
    nodes: [
      node('g', 'sebeke', { gerilim: 400 }),
      node('mdb', 'mdb', { diversity: div, nominalAkim: 100000 }),
      node('l1', 'genelYuk', { kuruluKw: 600, pf: 1, df: 1, isiKonum: 'salon' }),
      node('l2', 'genelYuk', { kuruluKw: 400, pf: 1, df: 1, isiKonum: 'dis' }),
    ],
    edges: [edge('g', 'mdb'), edge('mdb', 'l1'), edge('mdb', 'l2')],
  })

  it('pano çıkış talebini çarpar', () => {
    const a = analyze(build(0.8))
    expect(a.nodes.mdb.totalKw).toBeCloseTo(800, 6)
    expect(a.totals.totalKw).toBeCloseTo(800, 6)
  })

  it('ısıl yük de diversity ile ölçeklenir ve çekilen güçle eşleşir', () => {
    const a = analyze(build(0.8))
    expect(a.heat.salonKw).toBeCloseTo(480, 6)
    expect(a.heat.disKw).toBeCloseTo(320, 6)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('faktör 1 iken değişiklik yok', () => {
    expect(analyze(build(1)).totals.totalKw).toBeCloseTo(1000, 6)
  })

  it('hat akımı hedefin kendi pikinden hesaplanır (diversity uygulanmaz)', () => {
    const a = analyze(build(0.5))
    expect(a.edges['mdb>l1'].p).toBeCloseTo(600, 6)
  })
})

describe('değişmezler', () => {
  it('çift beslemede ve yedekte ısı toplamı çekilen güce eşit', () => {
    const nodes = [
      node('g', 'sebeke'), node('gen', 'jenerator'),
      node('t1', 'trafo', { nominalKva: 2000 }), node('t2', 'trafo', { nominalKva: 2000 }),
      node('mdb', 'mdb', { diversity: 0.9 }), node('u', 'ups', { verimModu: 'egri' }),
      node('it', 'itYuku', { kuruluKw: 400, pf: 0.9, df: 0.9 }),
      node('m', 'mekanikYuk', { kuruluKw: 200, pf: 0.85, df: 0.8 }),
    ]
    const edges = [
      edge('g', 't1', { gerilim: 34500 }), edge('g', 't2', { gerilim: 34500 }),
      edge('t1', 'mdb', { r: 0.1, x: 0.08, uzunluk: 30 }), edge('t2', 'mdb', { r: 0.1, x: 0.08, uzunluk: 30 }),
      edge('gen', 'mdb', { pay: 0 }),
      edge('mdb', 'u', { r: 0.1, uzunluk: 20 }), edge('u', 'it', { r: 0.05, uzunluk: 15 }), edge('mdb', 'm', { r: 0.1, uzunluk: 40 }),
    ]
    const a = analyze({ nodes, edges })
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 6)
    expect(a.losses.upsKw + a.losses.trafoKw + a.losses.lineKw).toBeCloseTo(a.totals.lossKw, 6)
  })

  it('IT yoksa PUE tanımsız', () => {
    const a = analyze({
      nodes: [node('g', 'sebeke', { gerilim: 400 }), node('l', 'mekanikYuk', { kuruluKw: 10, df: 1, pf: 1 })],
      edges: [edge('g', 'l')],
    })
    expect(a.pue).toBeUndefined()
  })

  it('kaynağa ulaşmayan yük ısıya katılmaz', () => {
    const a = analyze({
      nodes: [node('g', 'sebeke'), node('m', 'mdb'), node('l', 'itYuku', { kuruluKw: 50, df: 1, pf: 1 })],
      edges: [edge('m', 'l')],
    })
    expect(a.heat.totalKw).toBe(0)
  })
})

describe('pano iç bara kaybı (3·I²·R·L / 1000)', () => {
  // 400 V, pf = 1: 277,128 kW → I = 400 A.
  const plant = (panel: Params) => {
    const nodes = [node('g', 'sebeke'), node('m', 'mdb', { nominalAkim: 4000, ...panel }), node('l', 'itYuku', { kuruluKw: 400 * Math.sqrt(3) * 0.4, pf: 1, df: 1 })]
    return { nodes, edges: [edge('g', 'm'), edge('m', 'l')] }
  }

  it('elle girilen direnç: R = 0,05 mΩ/m, L = 10 m → 3·400²·5e-5·10/1000 = 0,24 kW', () => {
    const a = analyze(plant({ baraDirenc: 0.05, baraUzunluk: 10 }))
    expect(a.nodes.m.ownLossKw).toBeCloseTo(0.24, 6)
    expect(a.losses.panelKw).toBeCloseTo(0.24, 6)
    expect(a.totals.totalKw).toBeCloseTo(400 * Math.sqrt(3) * 0.4 + 0.24, 6)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
    expect(a.heat.elektrikKw).toBeCloseTo(0.24, 6)
  })

  it('direnç 0 ise nominal akımdan tahmin edilir: R = 34,4 / In mΩ/m', () => {
    const a = analyze(plant({ baraUzunluk: 6 }))
    // R = 34,4/4000 = 0,0086 mΩ/m → 3·400²·8,6e-6·6/1000 = 0,024768 kW
    expect(a.nodes.m.ownLossKw).toBeCloseTo(0.024768, 6)
  })

  it('uzunluk 0 ise kayıp yok; enerjisiz panoda kayıp yok', () => {
    expect(analyze(plant({ baraUzunluk: 0 })).losses.panelKw).toBe(0)
    const f = plant({ baraDirenc: 0.05, baraUzunluk: 10 })
    const a = analyze(f, undefined, { id: 's', ad: 's', failedNodes: ['g'], edgeStates: {}, nodeStates: {} })
    expect(a.nodes.m.ownLossKw).toBe(0)
  })

  it('kayıp dökümü: kalemler tür/ad ile listelenir, toplamı toplam kayba eşittir', () => {
    const f = plant({ baraDirenc: 0.05, baraUzunluk: 10 })
    f.edges[1].tip = 'busbar'
    f.edges[1].r = 0.1
    f.edges[1].ad = 'BB/TEST'
    f.edges[1].uzunluk = 20
    const a = analyze(f)
    const bus = a.lossItems.find((i) => i.kind === 'busbar')!
    expect(bus.name).toBe('BB/TEST')
    expect(bus.kw).toBeCloseTo(a.edges['m>l'].lossKw, 9)
    expect(a.lossItems.find((i) => i.kind === 'pano')!.kw).toBeCloseTo(0.24, 2) // hat kaybı panonun akımını biraz artırır
    const sum = a.lossItems.reduce((x, i) => x + i.kw, 0)
    expect(sum).toBeCloseTo(a.losses.upsKw + a.losses.trafoKw + a.losses.lineKw + a.losses.panelKw, 9)
    expect(a.lossItems[0].kw).toBeGreaterThanOrEqual(a.lossItems[a.lossItems.length - 1].kw)
  })
})
