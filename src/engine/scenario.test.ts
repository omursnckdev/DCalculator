import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode, Scenario } from '../model/types'
import { analyze } from './analyze'
import { runN1 } from './scenario'

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
const scn = (failed: string[] = [], edgeStates: Scenario['edgeStates'] = {}): Scenario => ({ id: 's', ad: 's', failedNodes: failed, edgeStates, nodeStates: {} })
const grid = (id: string) => node(id, 'sebeke', { gerilim: 400 })

/**
 * Topoloji A — 2N UPS (tüm yükler pf = 1, UPS verimi %100, hatlarda R = 0):
 *   Şebeke ─ MDB ─┬─ UPS1 ─┐
 *                 └─ UPS2 ─┴─ IT (400 kW, iki UPS'ten çift beslemeli)
 *  Normal : UPS1 = UPS2 = 200 kW (%40)           MDB = 400 kW
 *  UPS1 arıza : UPS2 = 400 kW → %80 (sarı), yük kaybı yok
 *  Her iki UPS / MDB / şebeke arıza : 400 kW kayıp
 */
function topoA() {
  const ups = { nominalKva: 500, nominalKw: 500, verim: 100, verimModu: 'sabit', girisPf: 1 }
  return {
    nodes: [grid('g'), node('mdb', 'mdb'), node('ups1', 'ups', ups), node('ups2', 'ups', ups), node('it', 'itYuku', { kuruluKw: 400, pf: 1, df: 1 })],
    edges: [edge('g', 'mdb'), edge('mdb', 'ups1'), edge('mdb', 'ups2'), edge('ups1', 'it'), edge('ups2', 'it')],
  }
}

describe('2N yük aktarımı', () => {
  const m = topoA()
  it('normal çalışmada yük eşit paylaşılır', () => {
    const a = analyze(m)
    expect(a.nodes.ups1.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.ups2.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.ups1.loadingPct).toBeCloseTo(40, 6)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('UPS1 arızalanınca UPS2 tüm yükü alır', () => {
    const a = analyze(m, undefined, scn(['ups1']))
    expect(a.nodes.ups1.energized).toBe(false)
    expect(a.nodes.ups1.failed).toBe(true)
    expect(a.nodes.ups1.totalKw).toBe(0)
    expect(a.nodes.ups2.totalKw).toBeCloseTo(400, 6)
    expect(a.nodes.ups2.loadingPct).toBeCloseTo(80, 6)
    expect(a.nodes.ups2.status).toBe('warning')
    expect(a.nodes.mdb.totalKw).toBeCloseTo(400, 6)
    expect(a.totals.totalKw).toBeCloseTo(400, 6)
    expect(a.unserved.totalKw).toBe(0)
    expect(a.edges['ups1>it'].live).toBe(false)
    expect(a.edges['ups2>it'].share).toBeCloseTo(1, 9)
  })

  it('enerji korunumu: ısı = çekilen güç, senaryoda da', () => {
    const a = analyze(m, undefined, scn(['ups1']))
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('iki UPS birden arızalanırsa yük kaybedilir', () => {
    const a = analyze(m, undefined, scn(['ups1', 'ups2']))
    expect(a.unserved.itKw).toBeCloseTo(400, 6)
    expect(a.totals.totalKw).toBe(0)
    expect(a.issues.some((i) => i.severity === 'error' && /enerjisiz/.test(i.message))).toBe(true)
  })

  it('MDB arızası tüm yükü kaybettirir', () => {
    const a = analyze(m, undefined, scn(['mdb']))
    expect(a.unserved.itKw).toBeCloseTo(400, 6)
  })

  it('hat açılınca yük diğer hattan akar', () => {
    const a = analyze(m, undefined, scn([], { 'ups1>it': 'acik' }))
    expect(a.nodes.ups1.totalKw).toBeCloseTo(0, 6)
    expect(a.nodes.ups2.totalKw).toBeCloseTo(400, 6)
    expect(a.edges['ups1>it']).toBeUndefined() // açık hatta sonuç yok
  })

  it('senaryosuz analiz temel duruma eşittir', () => {
    expect(analyze(m, undefined, scn()).totals.totalKw).toBeCloseTo(analyze(m).totals.totalKw, 12)
  })
})

/**
 * Topoloji B — ATS ile jeneratör yedeği:
 *   Şebeke ─(pay %100)─┐
 *                      ATS ─ MDB ─ IT 300 kW
 *   Jeneratör ─(pay %0)┘   (400 kVA, pf 0,8 → 320 kW)
 *  Normal : şebeke 300 kW, jeneratör 0
 *  Şebeke arıza : jeneratör 300 kW → kW doluluğu 300/320 = %93,75, kVA 300/400 = %75 → %93,75
 */
function topoB(gridPay: number | null = 100, genPay: number | null = 0) {
  return {
    nodes: [
      grid('g'),
      node('gen', 'jenerator', { nominalKva: 400, pf: 0.8, gerilim: 400 }),
      node('ats', 'ats'),
      node('mdb', 'mdb'),
      node('it', 'itYuku', { kuruluKw: 300, pf: 1, df: 1 }),
    ],
    edges: [edge('g', 'ats', { pay: gridPay }), edge('gen', 'ats', { pay: genPay }), edge('ats', 'mdb'), edge('mdb', 'it')],
  }
}

describe('ATS / yedek jeneratör', () => {
  it('normalde tercih edilen kaynak taşır, jeneratör boşta', () => {
    const a = analyze(topoB())
    expect(a.nodes.g.totalKw).toBeCloseTo(300, 6)
    expect(a.nodes.gen.totalKw).toBeCloseTo(0, 6)
    expect(a.issues.filter((i) => /tercih/.test(i.message))).toEqual([])
  })

  it('şebeke arızasında jeneratör devralır', () => {
    const a = analyze(topoB(), undefined, scn(['g']))
    expect(a.nodes.gen.totalKw).toBeCloseTo(300, 6)
    expect(a.nodes.gen.loadingPct).toBeCloseTo(93.75, 6)
    expect(a.nodes.gen.status).toBe('warning')
    expect(a.nodes.ats.totalKw).toBeCloseTo(300, 6)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('küçük jeneratör devralınca aşırı yük bildirir', () => {
    const m = topoB()
    m.nodes[4].params.kuruluKw = 340 // 340 kW > 320 kW
    const a = analyze(m, undefined, scn(['g']))
    expect(a.nodes.gen.status).toBe('over')
    expect(a.issues.some((i) => i.severity === 'error' && i.nodeId === 'gen')).toBe(true)
  })

  it('ATS arızalanırsa yük kaybedilir', () => {
    const a = analyze(topoB(), undefined, scn(['ats']))
    expect(a.unserved.itKw).toBeCloseTo(300, 6)
  })

  it('ATS aynı anda yalnızca bir girişi aktif tutar; pay verilmese de jeneratör acil kaynaktır', () => {
    const a = analyze(topoB(null, null))
    expect(a.nodes.g.totalKw).toBeCloseTo(300, 6)
    expect(a.nodes.gen.totalKw).toBeCloseTo(0, 6)
    // normal kaynak + jeneratör: tercih belli, uyarı yok
    expect(a.issues.some((i) => i.nodeId === 'ats' && /tercih/.test(i.message))).toBe(false)
  })

  it('iki normal kaynak ve tercih verilmemişse ATS uyarır, ilk hat seçilir', () => {
    const m = {
      nodes: [grid('g1'), grid('g2'), node('ats', 'ats'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 })],
      edges: [edge('g1', 'ats'), edge('g2', 'ats'), edge('ats', 'it')],
    }
    const a = analyze(m)
    expect(a.nodes.g1.totalKw).toBeCloseTo(100, 6)
    expect(a.nodes.g2.totalKw).toBeCloseTo(0, 6)
    expect(a.issues.some((i) => i.nodeId === 'ats' && /tercih/.test(i.message))).toBe(true)
  })

  it('tek girişli ATS uyarılır', () => {
    const m = topoB()
    m.edges = m.edges.filter((e) => e.id !== 'gen>ats')
    expect(analyze(m).issues.some((i) => i.nodeId === 'ats' && /tek girişi/.test(i.message))).toBe(true)
  })

  it('jeneratör yedeği ATS olmadan da (pay 0) devralır', () => {
    const m = {
      nodes: [grid('g'), node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400 }), node('mdb', 'mdb'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 })],
      edges: [edge('g', 'mdb'), edge('gen', 'mdb', { pay: 0 }), edge('mdb', 'it')],
    }
    expect(analyze(m).nodes.gen.totalKw).toBeCloseTo(0, 6)
    expect(analyze(m, undefined, scn(['g'])).nodes.gen.totalKw).toBeCloseTo(100, 6)
  })
})

/**
 * Topoloji C — bara kuplajı:
 *   Şebeke1 ─ BaraA (IT 200 kW)        BaraB (IT 300 kW) ─ Şebeke2
 *   Kuplaj: B→A ve A→B hatları, normalde AÇIK.
 */
function topoC(tieBA: 'acik' | 'kapali' = 'acik', tieAB: 'acik' | 'kapali' = 'acik') {
  return {
    nodes: [
      grid('g1'), grid('g2'), node('A', 'mdb'), node('B', 'mdb'),
      node('la', 'itYuku', { kuruluKw: 200, pf: 1, df: 1 }), node('lb', 'itYuku', { kuruluKw: 300, pf: 1, df: 1 }),
    ],
    edges: [
      edge('g1', 'A'), edge('g2', 'B'), edge('A', 'la'), edge('B', 'lb'),
      edge('B', 'A', { durum: tieBA }), edge('A', 'B', { durum: tieAB }),
    ],
  }
}

describe('bara kuplajı', () => {
  it('açık kuplajda iki bara bağımsızdır', () => {
    const a = analyze(topoC())
    expect(a.nodes.g1.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.g2.totalKw).toBeCloseTo(300, 6)
    expect(a.issues.some((i) => /döngü/.test(i.message))).toBe(false)
  })

  it('şebeke1 arızası, kuplaj açıkken A barasının yükünü kaybettirir', () => {
    const a = analyze(topoC(), undefined, scn(['g1']))
    expect(a.unserved.itKw).toBeCloseTo(200, 6)
    expect(a.nodes.A.energized).toBe(false)
  })

  it('kuplaj kapatılınca B barası A\'yı da besler', () => {
    const a = analyze(topoC(), undefined, scn(['g1'], { 'B>A': 'kapali' }))
    expect(a.unserved.totalKw).toBe(0)
    expect(a.nodes.A.energized).toBe(true)
    expect(a.nodes.g2.totalKw).toBeCloseTo(500, 6)
    expect(a.nodes.g1.totalKw).toBe(0)
  })

  it('kuplaj kapalı ve iki kaynak sağlamsa yük paylaşılır, toplam değişmez', () => {
    const a = analyze(topoC(), undefined, scn([], { 'B>A': 'kapali' }))
    // A: g1 ve B hatlarından %50/%50 → g1 = 100, B'nin çıkışı 300 + 100 = 400
    expect(a.nodes.g1.totalKw).toBeCloseTo(100, 6)
    expect(a.nodes.g2.totalKw).toBeCloseTo(400, 6)
    expect(a.totals.totalKw).toBeCloseTo(500, 6)
  })

  it('iki kuplaj birden kapalıysa döngü hatası verir', () => {
    const a = analyze(topoC('kapali', 'kapali'))
    expect(a.nodes.A.cyclic).toBe(true)
    expect(a.issues.some((i) => i.severity === 'error' && /döngü/.test(i.message))).toBe(true)
  })

  it('temel durumdaki kapalı kuplaj da aynı kurala uyar', () => {
    const a = analyze(topoC('kapali', 'acik'), undefined, scn(['g1']))
    expect(a.unserved.totalKw).toBe(0)
  })
})

describe('N-1 taraması', () => {
  const rows = runN1(topoA())
  const row = (id: string) => rows.find((r) => r.id === id)!

  it('yedekli UPS arızasında yük kaybı yok, doluluk %80', () => {
    expect(row('ups1').lostItKw).toBe(0)
    expect(row('ups1').ok).toBe(true)
    expect(row('ups1').peak?.pct).toBeCloseTo(80, 6)
    expect(row('ups1').peak?.name).toBe('ups2')
  })

  it('tekil MDB ve şebeke arızası yük kaybettirir', () => {
    expect(row('mdb').lostItKw).toBeCloseTo(400, 6)
    expect(row('mdb').ok).toBe(false)
    expect(row('g').lostItKw).toBeCloseTo(400, 6)
  })

  it('hat arızası da taranır', () => {
    expect(row('ups1>it').kind).toBe('edge')
    expect(row('ups1>it').ok).toBe(true)
    expect(row('mdb>ups1').ok).toBe(true)
    expect(row('g>mdb').lostItKw).toBeCloseTo(400, 6)
  })

  it('yükler arıza adayı değildir', () => {
    expect(rows.find((r) => r.id === 'it')).toBeUndefined()
  })

  it('aşırı yüklenen ekipmanı raporlar', () => {
    const m = topoA()
    m.nodes[4].params.kuruluKw = 600 // UPS başına 300 kW normalde (%60); biri arızalanınca 600 kW → %120
    const r = runN1(m).find((x) => x.id === 'ups1')!
    expect(r.ok).toBe(false)
    expect(r.overloads.map((o) => o.name)).toContain('ups2')
    expect(r.lostItKw).toBe(0)
  })

  it('zaten enerjisiz yükler N-1 kaybına sayılmaz', () => {
    const m = topoA()
    m.nodes.push(node('orphan', 'itYuku', { kuruluKw: 50, pf: 1, df: 1 }))
    // 'orphan' hiçbir yere bağlı değil: temel durumda da enerjisiz
    expect(runN1(m).find((x) => x.id === 'ups1')!.lostItKw).toBe(0)
  })

  it('jeneratör yedekli topolojide şebeke arızası güvenli', () => {
    const r = runN1(topoB()).find((x) => x.id === 'g')!
    expect(r.lostItKw).toBe(0)
    expect(r.ok).toBe(true)
    expect(r.peak?.pct).toBeCloseTo(93.75, 6)
  })
})

describe('jeneratör acil kaynaktır: normal kaynak varken yük almaz', () => {
  const direct = () => ({
    // pay VERİLMEMİŞ: şebeke ve jeneratör aynı MDB'ye doğrudan bağlı
    nodes: [grid('g'), node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400 }), node('mdb', 'mdb'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 })],
    edges: [edge('g', 'mdb'), edge('gen', 'mdb'), edge('mdb', 'it')],
  })

  it('şebeke aktifken jeneratör yükte değildir (pay verilmese bile)', () => {
    const a = analyze(direct())
    expect(a.nodes.gen.totalKw).toBe(0)
    expect(a.nodes.g.totalKw).toBeCloseTo(100, 6)
    expect(a.edges['gen>mdb'].share).toBe(0)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('şebeke arızalanınca jeneratör tüm yükü alır', () => {
    const a = analyze(direct(), undefined, scn(['g']))
    expect(a.nodes.gen.totalKw).toBeCloseTo(100, 6)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('jeneratör hattına pay verilmişse uyarır ve normal kaynak varken yok sayar', () => {
    const m = direct()
    m.edges[1].pay = 50
    const a = analyze(m)
    expect(a.nodes.gen.totalKw).toBe(0)
    expect(a.issues.some((i) => i.edgeId === 'gen>mdb' && /acil kaynak/.test(i.message))).toBe(true)
  })

  it('tek kaynak jeneratörse pay uyarısı yok, jeneratör yükü taşır', () => {
    const m = {
      nodes: [node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400 }), node('mdb', 'mdb'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 })],
      edges: [edge('gen', 'mdb', { pay: 100 }), edge('mdb', 'it')],
    }
    const a = analyze(m)
    expect(a.nodes.gen.totalKw).toBeCloseTo(100, 6)
    expect(a.issues.some((i) => /acil kaynak/.test(i.message))).toBe(false)
  })

  /**
   * Trafo A arızalı, ATS-A yalnız jeneratörden besleniyor; ama B barası (şebekeli) kuplajla
   * A barasını da besleyebiliyor. Normal kaynaklı yol varken jeneratör yükte olmamalı.
   */
  const withTie = (tie: 'acik' | 'kapali') => ({
    nodes: [
      grid('g1'), grid('g2'), node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400 }),
      node('ta', 'trafo', { nominalKva: 2000, primerGerilim: 400, sekonderGerilim: 400, bostaKayip: 0, yukKayip: 0, uk: 0 }),
      node('tb', 'trafo', { nominalKva: 2000, primerGerilim: 400, sekonderGerilim: 400, bostaKayip: 0, yukKayip: 0, uk: 0 }),
      node('ats', 'ats'), node('A', 'mdb'), node('B', 'mdb'),
      node('la', 'itYuku', { kuruluKw: 200, pf: 1, df: 1 }), node('lb', 'itYuku', { kuruluKw: 300, pf: 1, df: 1 }),
    ],
    edges: [
      edge('g1', 'ta'), edge('g2', 'tb'), edge('ta', 'ats'), edge('gen', 'ats'), edge('ats', 'A'),
      edge('tb', 'B'), edge('A', 'la'), edge('B', 'lb'), edge('B', 'A', { durum: tie }),
    ],
  })

  it('trafo A arızası, kuplaj açık: jeneratör devralır', () => {
    const a = analyze(withTie('acik'), undefined, scn(['ta']))
    expect(a.nodes.gen.totalKw).toBeCloseTo(200, 6)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('trafo A arızası, kuplaj kapalı: B (şebekeli) taşır, jeneratör yükte değil', () => {
    const a = analyze(withTie('kapali'), undefined, scn(['ta']))
    expect(a.nodes.gen.totalKw).toBe(0)
    expect(a.nodes.ats.totalKw).toBe(0)
    expect(a.nodes.tb.totalKw).toBeCloseTo(500, 6)
    expect(a.unserved.totalKw).toBe(0)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('her iki trafo sağlamken kuplaj kapalı olsa da jeneratör yükte değildir', () => {
    const a = analyze(withTie('kapali'))
    expect(a.nodes.gen.totalKw).toBe(0)
    expect(a.totals.totalKw).toBeCloseTo(500, 6)
  })

  it('çift kablolu (2N) yük, jeneratörlü tarafla da paylaşmaya devam eder', () => {
    // IT yükü ta→ATS(gen)→A→UPS-A ve tb→B→UPS-B yollarından çift beslemeli
    const ups = { nominalKva: 1000, nominalKw: 1000, verim: 100, verimModu: 'sabit', girisPf: 1 }
    const m = withTie('acik')
    m.nodes.push(node('upsA', 'ups', ups), node('upsB', 'ups', ups), node('it', 'itYuku', { kuruluKw: 400, pf: 1, df: 1 }))
    m.edges = m.edges.filter((e) => e.id !== 'A>la' && e.id !== 'B>lb')
    m.edges.push(edge('A', 'upsA'), edge('B', 'upsB'), edge('upsA', 'it'), edge('upsB', 'it'))
    const a = analyze(m, undefined, scn(['ta']))
    expect(a.nodes.upsA.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.upsB.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.gen.totalKw).toBeCloseTo(200, 6) // A tarafı jeneratörde, yükünü taşır
  })

  it('N-1: jeneratör hiçbir tekil arızada gereksiz yük almaz (şebekeli hatlar sağlamsa)', () => {
    // g2/tb/B zinciri sağlamken ta arızası: jeneratör devralmalı (kuplaj açık)
    const r = runN1(withTie('acik')).find((x) => x.id === 'ta')!
    expect(r.lostItKw).toBe(0)
  })
})

describe('portlar', () => {
  const base = () => ({
    nodes: [grid('g1'), grid('g2'), node('ats', 'ats'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 })],
    edges: [edge('g1', 'ats'), edge('g2', 'ats'), edge('ats', 'it')],
  })

  it('eşit paylı ATS girişlerinde en düşük numaralı giriş seçilir', () => {
    const m = base()
    m.edges[0].hedefPort = 1 // g1 → Giriş 2
    m.edges[1].hedefPort = 0 // g2 → Giriş 1
    const a = analyze(m)
    expect(a.nodes.g2.totalKw).toBeCloseTo(100, 6)
    expect(a.nodes.g1.totalKw).toBeCloseTo(0, 6)
  })

  it('aynı porta iki hat bağlıysa hata verir', () => {
    const m = base()
    m.edges[1].hedefPort = m.edges[0].hedefPort
    expect(analyze(m).issues.some((i) => i.severity === 'error' && /portuna 2 hat/.test(i.message))).toBe(true)
  })

  it('var olmayan portu hata olarak bildirir', () => {
    const m = base()
    m.nodes[2].params.girisSayisi = 1
    expect(analyze(m).issues.some((i) => i.severity === 'error' && /2\. giriş portu yok/.test(i.message))).toBe(true)
  })

  it('temiz port atamasında port hatası yok', () => {
    expect(analyze(base()).issues.filter((i) => /port/.test(i.message))).toEqual([])
  })
})


describe('ATS/STS: açık tercih, jeneratör acil kuralını geçersiz kılar', () => {
  /**
   * UPS-A (jeneratörlü tarafta) ve catcher (normal kaynak) bir STS'ye giriyor; A tercihli (pay 100/0).
   * Trafo arızalı, A tarafı jeneratörde: tercih edilen A (UPS) yük taşımaya devam eder, catcher boşta kalır.
   */
  const build = (prefA: boolean) => {
    const pays = prefA ? { a: 100, b: 0 } : { a: null, b: null }
    return {
      nodes: [
        grid('g'), node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400 }), grid('catcher'),
        node('tx', 'trafo', { nominalKva: 2000, primerGerilim: 400, sekonderGerilim: 400, bostaKayip: 0, yukKayip: 0, uk: 0 }),
        node('ats', 'ats'), node('sts', 'sts'), node('it', 'itYuku', { kuruluKw: 200, pf: 1, df: 1 }),
      ],
      edges: [
        edge('g', 'tx'), edge('tx', 'ats'), edge('gen', 'ats'), edge('ats', 'sts', { pay: pays.a }), edge('catcher', 'sts', { pay: pays.b }), edge('sts', 'it'),
      ],
    }
  }

  it('açık tercih (A %100): trafo arızasında jeneratör A tarafını taşır, catcher boşta', () => {
    const a = analyze(build(true), undefined, scn(['tx']))
    expect(a.nodes.gen.totalKw).toBeCloseTo(200, 6)
    expect(a.nodes.catcher.totalKw).toBeCloseTo(0, 6)
  })

  it('tercih verilmemişse (otomatik) jeneratör acil kaynak kuralı işler: catcher devralır', () => {
    const a = analyze(build(false), undefined, scn(['tx']))
    expect(a.nodes.gen.totalKw).toBeCloseTo(0, 6)
    expect(a.nodes.catcher.totalKw).toBeCloseTo(200, 6)
  })
})

describe('kesici / ayırıcı düğümü', () => {
  const chain = (durum: 'kapali' | 'acik') => ({
    nodes: [
      grid('g'), node('mdb', 'mdb'), node('cb', 'kesici', { tip: 'ACB', nominalAkim: 1000, kutup: '4P', durum, gerilim: 400 }),
      node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 }), node('ct', 'yardimci', { altTip: 'akimTrafosu', gerilim: 400 }),
    ],
    edges: [edge('g', 'mdb'), edge('mdb', 'cb'), edge('cb', 'it'), edge('mdb', 'ct')],
  })

  it('kapalı kesici geçirgendir, akım doluluğunu hesaplar; ölçü elemanı güç çekmez', () => {
    const a = analyze(chain('kapali'))
    expect(a.nodes.cb.totalKw).toBeCloseTo(100, 6)
    expect(a.nodes.cb.loadingPct).toBeCloseTo(((100000 / (Math.sqrt(3) * 400)) / 1000) * 100, 4) // ≈ %14,4
    expect(a.nodes.ct.totalKw).toBe(0)
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('açık kesici arızı değil, hattı keser: AÇIK, yük enerjisiz', () => {
    const a = analyze(chain('acik'))
    expect(a.nodes.cb.open).toBe(true)
    expect(a.nodes.cb.failed).toBe(false)
    expect(a.nodes.it.energized).toBe(false)
    expect(a.totals.totalKw).toBe(0)
    // açık anahtar 'kaynağa bağlı değil' hatası üretmez (yapısal bağlantı var)
    expect(a.issues.some((i) => /hiçbir kaynağa/.test(i.message))).toBe(false)
  })

  it('temel durumda açık kesici yüzünden enerjisiz kalan yük uyarı olarak bildirilir (0 kW yükler hariç)', () => {
    const a = analyze(chain('acik'))
    expect(a.issues.some((i) => i.severity === 'warning' && /enerjisiz kaldı/.test(i.message))).toBe(true)
    const zero = chain('acik')
    zero.nodes[3].params.kuruluKw = 0
    expect(analyze(zero).issues.some((i) => /enerjisiz kaldı/.test(i.message))).toBe(false)
  })

  it('senaryo kesici durumunu geçersiz kılar (kapalı -> açık, açık -> kapalı)', () => {
    const open = analyze(chain('kapali'), undefined, { ...scn(), nodeStates: { cb: 'acik' } })
    expect(open.nodes.it.energized).toBe(false)
    expect(open.unserved.totalKw).toBeCloseTo(100, 6)
    const close = analyze(chain('acik'), undefined, { ...scn(), nodeStates: { cb: 'kapali' } })
    expect(close.nodes.it.energized).toBe(true)
    expect(close.totals.totalKw).toBeCloseTo(100, 6)
  })

  it('kesici arızası N-1\'de yükü kaybettirir', () => {
    const r = runN1(chain('kapali')).find((x) => x.id === 'cb')!
    expect(r.lostItKw).toBeCloseTo(100, 6)
  })

  it('kesici nominal akımını aşan yük aşırı yük olarak işaretlenir', () => {
    const m = chain('kapali')
    m.nodes[3].params.kuruluKw = 800 // 1155 A > 1000 A
    expect(analyze(m).nodes.cb.status).toBe('over')
  })
})
