import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze, currentOf } from './analyze'

/** Faz 2 testleri yük toplamayı doğrular; trafo kaybı Faz 3 testlerinde ayrıca sınanır. */
const NO_LOSS = { bostaKayip: 0, yukKayip: 0, uk: 0 }

let seq = 0
function node(id: string, type: EquipmentType, params: Params = {}, ad = id): ProjectNode {
  return { id, type, ad, etiket: '', grup: '', notlar: '', x: 0, y: seq++ * 10, params: { ...EQUIPMENT[type].defaults, ...params } }
}
function edge(source: string, target: string, over: Partial<ProjectEdge> = {}): ProjectEdge {
  return {
    id: `${source}>${target}`,
    source,
    target,
    tip: 'kablo',
    uzunluk: 10,
    akimKapasitesi: 100000,
    r: 0,
    x: 0,
    gerilim: 400,
    pay: null,
    isiKonum: 'elektrik',
    ...over,
  }
}

/**
 * ELLE HESAPLANMIŞ ÖRNEK (pf = 0.8 → tan φ = 0.75, UPS giriş pf = 1):
 *
 *  Şebeke ─ Trafo(2500 kVA) ─ MDB(4000 A) ─┬─ UPS(1000 kVA, 900 kW, η=%96) ─ UPS-DP(1600 A) ─┬─ IT1
 *                                          │                                               └─ IT2
 *                                          └─ Mekanik
 *
 *  IT1:  500 kW × DF 0.8 = 400 kW, Q = 300 kvar
 *  IT2:  200 kW × DF 1   = 200 kW, Q = 150 kvar
 *  UPS çıkışı: P = 600, Q = 450, S = 750 kVA  → %75 (kVA) / %66.67 (kW)
 *  UPS girişi: P = 600/0.96 = 625 kW, Q = 0 (pf=1) → kayıp 25 kW
 *  Mekanik: 300 kW × DF 0.8 = 240 kW, Q = 180 kvar
 *  MDB: P = 625 + 240 = 865, Q = 0 + 180 = 180 → S = √(865²+180²) = 883.53 kVA
 *       I = 883530 / (√3·400) = 1275.27 A → %31.88
 *  Trafo: 883.53 / 2500 = %35.34
 */
function reference() {
  const nodes = [
    node('grid', 'sebeke'),
    node('tr', 'trafo', NO_LOSS),
    node('mdb', 'mdb'),
    node('ups', 'ups', { girisPf: 1 }),
    node('upsdp', 'upsPanosu'),
    node('it1', 'itYuku', { kuruluKw: 500, pf: 0.8, df: 0.8 }),
    node('it2', 'itYuku', { kuruluKw: 200, pf: 0.8, df: 1 }),
    node('mek', 'mekanikYuk', { kuruluKw: 300, pf: 0.8, df: 0.8 }),
  ]
  const edges = [
    edge('grid', 'tr', { gerilim: 34500 }),
    edge('tr', 'mdb'),
    edge('mdb', 'ups'),
    edge('ups', 'upsdp'),
    edge('upsdp', 'it1'),
    edge('upsdp', 'it2'),
    edge('mdb', 'mek'),
  ]
  return { nodes, edges }
}

describe('yük hesabı (elle doğrulanmış örnek)', () => {
  const a = analyze(reference())

  it('yük düğümü: peak kW, kVA ve akım', () => {
    const r = a.nodes.it1
    expect(r.itKw).toBeCloseTo(400, 6)
    expect(r.kva).toBeCloseTo(500, 6)
    expect(r.currentA).toBeCloseTo(currentOf(500, 400), 6)
    expect(r.currentA).toBeCloseTo(721.69, 1)
  })

  it('UPS çıkışı: IT toplamı, kVA ve doluluk', () => {
    const r = a.nodes.ups
    expect(r.itKw).toBeCloseTo(600, 6)
    expect(r.mechKw).toBeCloseTo(0, 6)
    expect(r.kva).toBeCloseTo(750, 6)
    expect(r.loadingPct).toBeCloseTo(75, 6) // kVA (%75) kW'dan (%66.67) kısıtlayıcı
    expect(r.status).toBe('ok')
  })

  it('UPS giriş gücü ve kaybı (sabit verim)', () => {
    const r = a.nodes.ups
    expect(r.inputKw).toBeCloseTo(625, 6)
    expect(r.ownLossKw).toBeCloseTo(25, 6)
    expect(r.inputKva).toBeCloseTo(625, 6)
  })

  it('MDB: IT + mekanik + kayıp, kVA, akım, doluluk', () => {
    const r = a.nodes.mdb
    expect(r.itKw).toBeCloseTo(600, 6)
    expect(r.mechKw).toBeCloseTo(240, 6)
    expect(r.lossKw).toBeCloseTo(25, 6)
    expect(r.totalKw).toBeCloseTo(865, 6)
    expect(r.kva).toBeCloseTo(883.53, 2)
    expect(r.currentA).toBeCloseTo(1275.27, 1)
    expect(r.loadingPct).toBeCloseTo(31.88, 1)
  })

  it('trafo doluluğu', () => {
    expect(a.nodes.tr.loadingPct).toBeCloseTo(35.34, 1)
  })

  it('proje toplamı şebekeden çekilen güçtür', () => {
    expect(a.totals.itKw).toBeCloseTo(600, 6)
    expect(a.totals.mechKw).toBeCloseTo(240, 6)
    expect(a.totals.lossKw).toBeCloseTo(25, 6)
    expect(a.totals.totalKw).toBeCloseTo(865, 6)
    expect(a.totals.kva).toBeCloseTo(883.53, 2)
  })

  it('hat akımı hedefin talebinden gelir', () => {
    const e = a.edges['mdb>ups'] // UPS girişi: 625 kW, 0 kvar
    expect(e.kva).toBeCloseTo(625, 6)
    expect(e.currentA).toBeCloseTo(currentOf(625, 400), 6)
  })

  it('temiz şemada hata yok', () => {
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('her düğüm için "nasıl hesaplandı" adımları üretir', () => {
    for (const r of Object.values(a.nodes)) expect(r.explain.length).toBeGreaterThan(0)
  })
})

describe('doluluk eşikleri', () => {
  const build = (kw: number) => ({
    nodes: [node('g', 'sebeke'), node('p', 'dagitimPanosu', { nominalAkim: 1000 }), node('l', 'genelYuk', { kuruluKw: kw, pf: 1, df: 1 })],
    edges: [edge('g', 'p', { gerilim: 400 }), edge('p', 'l')],
  })
  // 1000 A @ 400 V, √3 → 692.82 kVA = 692.82 kW (pf 1)
  it.each([
    [300, 'ok'],
    [600, 'warning'], // ≈ %86.6
    [700, 'over'], // ≈ %101
  ])('%d kW → %s', (kw, status) => {
    const a = analyze(build(kw))
    expect(a.nodes.p.status).toBe(status)
  })

  it('aşırı yük hata olarak raporlanır', () => {
    const a = analyze(build(700))
    expect(a.issues.some((i) => i.severity === 'error' && i.nodeId === 'p')).toBe(true)
  })
})

describe('2N paylaşımı ve yedek besleme', () => {
  const base = () => [
    node('g', 'sebeke'),
    node('t1', 'trafo', { nominalKva: 2000, ...NO_LOSS }),
    node('t2', 'trafo', { nominalKva: 2000, ...NO_LOSS }),
    node('gen', 'jenerator'),
    node('mdb', 'mdb', { nominalAkim: 6000 }),
    node('l', 'itYuku', { kuruluKw: 1000, pf: 1, df: 1 }),
  ]

  it('iki besleme eşit (%50/%50) paylaşır', () => {
    const nodes = base().filter((n) => n.id !== 'gen')
    const edges = [
      edge('g', 't1', { gerilim: 34500 }),
      edge('g', 't2', { gerilim: 34500 }),
      edge('t1', 'mdb'),
      edge('t2', 'mdb'),
      edge('mdb', 'l'),
    ]
    const a = analyze({ nodes, edges })
    expect(a.nodes.t1.totalKw).toBeCloseTo(500, 6)
    expect(a.nodes.t2.totalKw).toBeCloseTo(500, 6)
    expect(a.nodes.mdb.totalKw).toBeCloseTo(1000, 6)
    expect(a.totals.totalKw).toBeCloseTo(1000, 6) // çift sayılmaz
  })

  it('jeneratör pay=0 ile yedek kalır, yük şebekede', () => {
    const nodes = base().filter((n) => !['t2'].includes(n.id))
    const edges = [
      edge('g', 't1', { gerilim: 34500 }),
      edge('t1', 'mdb'),
      edge('gen', 'mdb', { pay: 0 }),
      edge('mdb', 'l'),
    ]
    const a = analyze({ nodes, edges })
    expect(a.nodes.gen.totalKw).toBeCloseTo(0, 6)
    expect(a.nodes.t1.totalKw).toBeCloseTo(1000, 6)
    expect(a.issues.some((i) => /pay/i.test(i.message))).toBe(false)
  })

  it('açık pay + otomatik: kalan yüzde otomatiklere bölünür', () => {
    const nodes = base()
    const edges = [
      edge('g', 't1', { gerilim: 34500 }),
      edge('g', 't2', { gerilim: 34500 }),
      edge('t1', 'mdb', { pay: 70 }),
      edge('t2', 'mdb'),
      edge('mdb', 'l'),
    ]
    const a = analyze({ nodes: nodes.filter((n) => n.id !== 'gen'), edges })
    expect(a.nodes.t1.totalKw).toBeCloseTo(700, 6)
    expect(a.nodes.t2.totalKw).toBeCloseTo(300, 6)
  })

  it('açık paylar %100 etmiyorsa uyarır', () => {
    const edges = [
      edge('g', 't1', { gerilim: 34500 }),
      edge('g', 't2', { gerilim: 34500 }),
      edge('t1', 'mdb', { pay: 60 }),
      edge('t2', 'mdb', { pay: 30 }),
      edge('mdb', 'l'),
    ]
    const a = analyze({ nodes: base().filter((n) => n.id !== 'gen'), edges })
    expect(a.issues.some((i) => i.severity === 'warning' && i.nodeId === 'mdb')).toBe(true)
  })
})

describe('hat: akım kapasitesi ve gerilim düşümü', () => {
  // 100 kW, pf 1, 400 V → S = 100 kVA, I = 144.34 A
  // ΔV = √3·I·L·R = (100000/400)·0.1 km·0.2 Ω/km = 250·0.02 = 5.0 V → %1.25
  const make = (over: Partial<ProjectEdge>) => ({
    nodes: [node('g', 'sebeke'), node('p', 'dagitimPanosu'), node('l', 'genelYuk', { kuruluKw: 100, pf: 1, df: 1 })],
    edges: [edge('g', 'p', { gerilim: 400 }), edge('p', 'l', { uzunluk: 100, r: 0.2, x: 0.1, ...over })],
  })

  it('gerilim düşümü formülü', () => {
    const a = analyze(make({ akimKapasitesi: 200 }))
    const r = a.edges['p>l']
    expect(r.currentA).toBeCloseTo(144.34, 2)
    expect(r.voltageDropPct).toBeCloseTo(1.25, 6)
    expect(r.loadingPct).toBeCloseTo(72.17, 1)
    expect(r.status).toBe('ok')
  })

  it('reaktif bileşen X ile katkı verir (pf 0.8)', () => {
    const m = make({ akimKapasitesi: 1000 })
    m.nodes[2].params.pf = 0.8
    // S = 125 kVA, I = 180.42 A, ΔV = √3·I·0.1·(0.2·0.8 + 0.1·0.6) = 312.5·0.1·0.22 = 6.875 V → %1.71875
    const r = analyze(m).edges['p>l']
    expect(r.currentA).toBeCloseTo(180.42, 2)
    expect(r.voltageDropPct).toBeCloseTo(1.71875, 4)
  })

  it('gerilim düşümü sınırı aşılırsa uyarır', () => {
    const a = analyze(make({ uzunluk: 300, akimKapasitesi: 1000 })) // %3.75
    expect(a.issues.some((i) => i.edgeId === 'p>l' && /gerilim düşümü/.test(i.message))).toBe(true)
  })

  it('hat aşırı yüklenirse hata verir', () => {
    const a = analyze(make({ akimKapasitesi: 100 }))
    expect(a.edges['p>l'].status).toBe('over')
    expect(a.issues.some((i) => i.severity === 'error' && i.edgeId === 'p>l')).toBe(true)
  })
})

describe('canlı doğrulama', () => {
  it('bağlantısız düğümü işaretler', () => {
    const a = analyze({ nodes: [node('g', 'sebeke'), node('x', 'mdb')], edges: [] })
    expect(a.issues.some((i) => i.nodeId === 'x')).toBe(true)
  })

  it('kaynağa ulaşmayan düğümü hata olarak işaretler, toplama katmaz', () => {
    const a = analyze({
      nodes: [node('m', 'mdb'), node('l', 'itYuku', { kuruluKw: 50, df: 1, pf: 1 }), node('g', 'sebeke')],
      edges: [edge('m', 'l')],
    })
    expect(a.issues.some((i) => i.severity === 'error' && i.nodeId === 'm')).toBe(true)
    expect(a.totals.totalKw).toBe(0)
  })

  it('döngüyü yakalar ve çökmez', () => {
    const a = analyze({
      nodes: [node('a', 'mdb'), node('b', 'dagitimPanosu')],
      edges: [edge('a', 'b'), edge('b', 'a')],
    })
    expect(a.nodes.a.cyclic).toBe(true)
    expect(a.issues.some((i) => i.severity === 'error' && /döngü/.test(i.message))).toBe(true)
  })

  it('gerilim uyumsuzluğunu yakalar', () => {
    const a = analyze({
      nodes: [node('g', 'sebeke'), node('t', 'trafo', { primerGerilim: 10000 })],
      edges: [edge('g', 't', { gerilim: 34500 })],
    })
    expect(a.issues.some((i) => i.severity === 'error' && i.edgeId === 'g>t')).toBe(true)
  })

  it('geçerli gerilim zincirinde uyumsuzluk yok', () => {
    const a = analyze(reference())
    expect(a.issues.filter((i) => /uyumsuz/.test(i.message))).toEqual([])
  })

  it('eski dosyada eksik parametre kütüphane varsayılanına düşer', () => {
    const n = node('u', 'ups')
    delete n.params.girisPf
    const a = analyze({
      nodes: [node('g', 'sebeke', { gerilim: 400 }), n, node('l', 'itYuku', { kuruluKw: 100, df: 1, pf: 1 })],
      edges: [edge('g', 'u'), edge('u', 'l')],
    })
    expect(a.nodes.u.inputKw).toBeCloseTo(100 / 0.96, 6)
  })
})
