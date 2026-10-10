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
  return {
    id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++ * 10,
    params: { ...EQUIPMENT[type].defaults, girisSayisi: 12, cikisSayisi: 12, ...params },
  }
}
function edge(source: string, target: string, over: Partial<ProjectEdge> = {}): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 10, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '',
    kaynakPort: nextPort(`${source}:out`), hedefPort: nextPort(`${target}:in`), ...over,
  }
}
const scn = (failed: string[] = [], nodeStates: Scenario['nodeStates'] = {}): Scenario => ({
  id: 's', ad: 's', failedNodes: failed, edgeStates: {}, nodeStates,
})
const grid = (id: string) => node(id, 'sebeke', { gerilim: 400 })
const NO_LOSS = { bostaKayip: 0, yukKayip: 0, uk: 0 }

/**
 * UPS + bakım bypass:
 *   Şebeke ─ MSB ─┬─ [giriş ACB] ─ UPS ─ [çıkış ACB] ─┬─ UDP ─ IT 100 kW
 *                 └─ [bypass ACB (oto)] ─ [bypass ACB (oto)] ─┘
 * Bypass ACB'leri normalde AÇIK; UPS yoksa UDP doğrudan MSB'den beslenmeli.
 */
function upsPlant(auto: 'otomatik' | 'yok' = 'otomatik') {
  const ups = { nominalKva: 500, nominalKw: 500, verim: 100, verimModu: 'sabit', girisPf: 1 }
  const cb = (id: string, durum: 'kapali' | 'acik', otomatik: 'otomatik' | 'yok' = 'yok') =>
    node(id, 'kesici', { tip: 'ACB', nominalAkim: 1600, kutup: '4P', durum, otomatik, gerilim: 400 })
  return {
    nodes: [
      grid('g'), node('msb', 'mdb'), cb('in', 'kapali'), node('ups', 'ups', ups), cb('out', 'kapali'),
      cb('byp1', 'acik', auto), cb('byp2', 'acik', auto), node('udp', 'mdb'), node('it', 'itYuku', { kuruluKw: 100, pf: 1, df: 1 }),
    ],
    edges: [
      edge('g', 'msb'), edge('msb', 'in'), edge('in', 'ups'), edge('ups', 'out'), edge('out', 'udp'),
      edge('msb', 'byp1'), edge('byp1', 'byp2'), edge('byp2', 'udp'), edge('udp', 'it'),
    ],
  }
}

describe('UPS arızasında hard bypass otomatik kapanır', () => {
  it('UPS sağlamken bypass açık kalır, yükü UPS taşır', () => {
    const a = analyze(upsPlant())
    expect(a.nodes.byp1.autoClosed).toBe(false)
    expect(a.nodes.byp1.open).toBe(true)
    expect(a.nodes.ups.totalKw).toBeCloseTo(100, 6)
  })

  it('UPS arızalanınca bypass kesicileri kapanır, UDP doğrudan MSB\'den beslenir', () => {
    const a = analyze(upsPlant(), undefined, scn(['ups']))
    expect(a.nodes.byp1.autoClosed).toBe(true)
    expect(a.nodes.byp2.autoClosed).toBe(true)
    expect(a.nodes.byp1.open).toBe(false)
    expect(a.nodes.udp.energized).toBe(true)
    expect(a.nodes.ups.energized).toBe(false)
    expect(a.unserved.totalKw).toBe(0)
    expect(a.nodes.msb.totalKw).toBeCloseTo(100, 6)
    expect(a.edges['byp2>udp'].live).toBe(true)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('UPS giriş kesicisi açılınca da (UPS çıkışsız kalır) bypass devreye girer', () => {
    const a = analyze(upsPlant(), undefined, scn([], { in: 'acik' }))
    expect(a.nodes.byp1.autoClosed).toBe(true)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('"Otomatik" işaretli değilse bypass elle kapatılana kadar açık kalır: yük kaybı', () => {
    const a = analyze(upsPlant('yok'), undefined, scn(['ups']))
    expect(a.nodes.byp1.autoClosed).toBe(false)
    expect(a.unserved.totalKw).toBeCloseTo(100, 6)
  })

  it('senaryoda elle açık bırakılan (kilitli) bypass otomatik kapanmaz', () => {
    const a = analyze(upsPlant(), undefined, scn(['ups'], { byp1: 'acik' }))
    expect(a.nodes.byp1.autoClosed).toBe(false)
    expect(a.unserved.totalKw).toBeCloseTo(100, 6)
  })

  it('zincirde elle açık, otomatik olmayan bir kesici varsa kapanmaz', () => {
    const m = upsPlant()
    m.nodes.find((n) => n.id === 'byp2')!.params.otomatik = 'yok'
    const a = analyze(m, undefined, scn(['ups']))
    expect(a.nodes.byp1.autoClosed).toBe(false)
    expect(a.unserved.totalKw).toBeCloseTo(100, 6)
  })

  it('N-1: UPS veya UPS kesicisi arızası yük kaybettirmez', () => {
    const rows = runN1(upsPlant())
    for (const id of ['ups', 'in', 'out']) {
      const r = rows.find((x) => x.id === id)!
      expect(r.lostItKw, id).toBe(0)
      expect(r.ok, id).toBe(true)
    }
    expect(rows.find((x) => x.id === 'msb')!.ok).toBe(false)
  })
})

/**
 * Senkron panosu ve jeneratör yük sıralaması:
 *   Şebeke ─ TX ─┐
 *   GEN1 ─ ACB ─ SYNC ─┬─ MSB ─ IT (kW değişken)        (jeneratörler 1000 kVA, eşik %70)
 *   GEN2 ─ ACB ─┘
 */
function genPlant(loadKw: number, extra: { gens?: number; mod?: 'sirali' | 'esit'; esik?: number } = {}) {
  const gens = extra.gens ?? 2
  const nodes: ProjectNode[] = [
    grid('g'), node('tx', 'trafo', { nominalKva: 5000, primerGerilim: 400, sekonderGerilim: 400, ...NO_LOSS }), node('msb', 'mdb'),
    node('sync', 'senkron', { mod: extra.mod ?? 'sirali', esik: extra.esik ?? 70 }),
    node('it', 'itYuku', { kuruluKw: loadKw, pf: 1, df: 1 }),
  ]
  const edges: ProjectEdge[] = [edge('g', 'tx'), edge('tx', 'msb')]
  for (let i = 1; i <= gens; i++) {
    nodes.push(node(`gen${i}`, 'jenerator', { nominalKva: 1000, gerilim: 400, pf: 0.8 }))
    nodes.push(node(`cb${i}`, 'kesici', { tip: 'ACB', nominalAkim: 2000, kutup: '4P', durum: 'kapali', gerilim: 400 }))
    edges.push(edge(`gen${i}`, `cb${i}`), edge(`cb${i}`, 'sync'))
  }
  edges.push(edge('sync', 'msb'), edge('msb', 'it'))
  return { nodes, edges }
}

describe('senkron panosu: jeneratör yük sıralaması', () => {
  it('şebeke varken jeneratörler yedekte ve çalışmıyor (yedekte işareti yok)', () => {
    const a = analyze(genPlant(500))
    expect(a.nodes.gen1.totalKw).toBe(0)
    expect(a.nodes.gen2.standby).toBe(false)
  })

  it('trafo arızası, yük %70 eşiğinin altında: 2. jeneratör kapanır, 1. tüm yükü taşır', () => {
    const a = analyze(genPlant(500), undefined, scn(['tx']))
    expect(a.nodes.gen1.totalKw).toBeCloseTo(500, 6)
    expect(a.nodes.gen1.loadingPct).toBeCloseTo(62.5, 6) // kW doluluğu: 500 / (1000 × 0,8)
    expect(a.nodes.gen2.standby).toBe(true)
    expect(a.nodes.gen2.energized).toBe(true)
    expect(a.nodes.gen2.totalKw).toBe(0)
    expect(a.unserved.totalKw).toBe(0)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 9)
  })

  it('yük eşiğin üzerindeyse iki jeneratör eşit paylaşır', () => {
    const a = analyze(genPlant(800), undefined, scn(['tx']))
    expect(a.nodes.gen1.totalKw).toBeCloseTo(400, 6)
    expect(a.nodes.gen2.totalKw).toBeCloseTo(400, 6)
    expect(a.nodes.gen2.standby).toBe(false)
  })

  it('tam eşik değerinde (%70) 2. jeneratör kapanır', () => {
    const a = analyze(genPlant(700), undefined, scn(['tx']))
    expect(a.nodes.gen2.standby).toBe(true)
    expect(a.nodes.gen1.totalKw).toBeCloseTo(700, 6)
  })

  it('eşik panodan ayarlanır', () => {
    // %50 eşik: 600 kVA > 500 → iki jeneratör
    const a = analyze(genPlant(600, { esik: 50 }), undefined, scn(['tx']))
    expect(a.nodes.gen2.standby).toBe(false)
    expect(a.nodes.gen2.totalKw).toBeCloseTo(300, 6)
  })

  it('"eşit" modda yük ne olursa olsun tümü çalışır', () => {
    const a = analyze(genPlant(300, { mod: 'esit' }), undefined, scn(['tx']))
    expect(a.nodes.gen1.totalKw).toBeCloseTo(150, 6)
    expect(a.nodes.gen2.totalKw).toBeCloseTo(150, 6)
  })

  it('öncelikli jeneratör arızalıysa diğeri çalışmaya devam eder', () => {
    const a = analyze(genPlant(500), undefined, scn(['tx', 'gen1']))
    expect(a.nodes.gen2.totalKw).toBeCloseTo(500, 6)
    expect(a.nodes.gen2.standby).toBe(false)
  })

  it('üç jeneratör: yüke göre gereken kadarı çalışır', () => {
    // 1300 kVA: 1 gen 700, 2 gen 1400 ≥ 1300 → 2 çalışır, 3. yedekte
    const a2 = analyze(genPlant(1300, { gens: 3 }), undefined, scn(['tx']))
    expect([a2.nodes.gen1.standby, a2.nodes.gen2.standby, a2.nodes.gen3.standby]).toEqual([false, false, true])
    expect(a2.nodes.gen1.totalKw).toBeCloseTo(650, 6)
    // 1500 kVA: 2 gen 1400 < 1500 → 3 jeneratör
    const a3 = analyze(genPlant(1500, { gens: 3 }), undefined, scn(['tx']))
    expect([a3.nodes.gen1.standby, a3.nodes.gen2.standby, a3.nodes.gen3.standby]).toEqual([false, false, false])
  })

  it('kesici açıksa o jeneratör üyelikten düşer', () => {
    const a = analyze(genPlant(300), undefined, scn(['tx'], { cb2: 'acik' }))
    expect(a.nodes.gen1.totalKw).toBeCloseTo(300, 6)
    expect(a.nodes.gen2.standby).toBe(false) // yedekte değil: kolu açık, zaten yük almıyor
    expect(a.nodes.gen2.totalKw).toBe(0)
    expect(a.nodes.cb2.open).toBe(true)
  })
})
