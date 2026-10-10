import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { simulateFailure, simulateRecovery } from './simulate'

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
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 10, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '',
    kaynakPort: nextPort(`${source}:out`), hedefPort: nextPort(`${target}:in`), ...over,
  }
}
const grid = (id: string) => node(id, 'sebeke', { gerilim: 400 })
const NO_LOSS = { bostaKayip: 0, yukKayip: 0, uk: 0 }
const cb = (id: string, durum: 'kapali' | 'acik' = 'kapali', otomatik: 'otomatik' | 'yok' = 'yok') =>
  node(id, 'kesici', { tip: 'ACB', nominalAkim: 2000, kutup: '4P', durum, otomatik, gerilim: 400 })
const upsP = { nominalKva: 1000, nominalKw: 1000, verim: 100, verimModu: 'sabit', girisPf: 1 }
const ids = (steps: { id: string }[]) => steps.map((s) => s.id)

/**
 *  Şebeke ─ TX ─ MSB ─┬─ ACB ─ UPS ─ ACB ─ UDP ─ IT 400 kW
 *  GEN1 ─ ACB ─ SYNC ─┤   └ bypass (oto) ─────────┘
 *  GEN2 ─ ACB ────────┘ └ Chiller 100 kW
 */
function plant(bataryaDk = 10, withGens = true) {
  const nodes: ProjectNode[] = [
    grid('g'), node('tx', 'trafo', { nominalKva: 5000, primerGerilim: 400, sekonderGerilim: 400, ...NO_LOSS }), node('msb', 'mdb'),
    cb('in'), node('ups', 'ups', { ...upsP, bataryaDk }), cb('out'), cb('byp1', 'acik', 'otomatik'), cb('byp2', 'acik', 'otomatik'),
    node('udp', 'mdb'), node('it', 'itYuku', { kuruluKw: 400, pf: 1, df: 1 }), node('chiller', 'mekanikYuk', { kuruluKw: 100, pf: 1, df: 1 }),
  ]
  const edges: ProjectEdge[] = [
    edge('g', 'tx'), edge('tx', 'msb'), edge('msb', 'in'), edge('in', 'ups'), edge('ups', 'out'), edge('out', 'udp'),
    edge('msb', 'byp1'), edge('byp1', 'byp2'), edge('byp2', 'udp'), edge('udp', 'it'), edge('msb', 'chiller'),
  ]
  if (withGens) {
    nodes.push(node('sync', 'senkron'))
    for (const i of [1, 2]) {
      nodes.push(node(`gen${i}`, 'jenerator', { nominalKva: 1000, gerilim: 400, pf: 0.8 }), cb(`cg${i}`))
      edges.push(edge(`gen${i}`, `cg${i}`), edge(`cg${i}`, 'sync'))
    }
    edges.push(edge('sync', 'msb'))
  }
  return { nodes, edges }
}

describe('adım adım arıza simülasyonu', () => {
  it('trafo arızası: batarya → jeneratörler → yük sıralaması', () => {
    const steps = simulateFailure(plant(), ['tx'])
    expect(ids(steps)).toEqual(['normal', 'fault', 'gen', 'staging'])

    const [normal, fault, gen, staging] = steps
    expect(normal.lostKw).toBe(0)
    // Arıza anı: MSB enerjisiz, chiller kaybedilir; IT yükü UPS bataryasıyla sürer
    expect(fault.analysis.nodes.msb.energized).toBe(false)
    expect(fault.analysis.nodes.ups.onBattery).toBe(true)
    expect(fault.analysis.nodes.it.energized).toBe(true)
    expect(fault.lostKw).toBeCloseTo(100, 6)
    expect(fault.changes[0].kind).toBe('fault')
    expect(fault.changes.some((c) => c.kind === 'lost' && /Chiller|chiller/.test(c.text))).toBe(true)
    expect(fault.changes.some((c) => c.kind === 'battery' && /bataryaya/.test(c.text))).toBe(true)
    // Jeneratörler devrede: MSB geri gelir, UPS şebeke girişine döner, iki jeneratör paylaşır
    expect(gen.lostKw).toBe(0)
    expect(gen.analysis.nodes.ups.onBattery).toBe(false)
    expect(gen.analysis.nodes.gen1.totalKw).toBeCloseTo(gen.analysis.nodes.gen2.totalKw, 6)
    expect(gen.changes.some((c) => c.kind === 'genStart')).toBe(true)
    expect(gen.changes.some((c) => c.kind === 'battery' && /döndü/.test(c.text))).toBe(true)
    // Yük sıralaması: 500 kW < 700 kVA eşik → 2. jeneratör yedekte
    expect(staging.analysis.nodes.gen2.standby).toBe(true)
    expect(staging.analysis.nodes.gen1.totalKw).toBeCloseTo(500, 6)
    expect(staging.changes.some((c) => c.kind === 'standby')).toBe(true)
    // zaman etiketleri
    expect(fault.timeLabel).toBe('t = 0')
    expect(gen.seconds).toBe(10)
  })

  it('UPS arızası: önce yük kaybı, sonra hard bypass otomatik kapanır', () => {
    const steps = simulateFailure(plant(), ['ups'])
    expect(ids(steps)).toEqual(['normal', 'fault', 'bypass'])
    const [, fault, bypass] = steps
    expect(fault.lostKw).toBeCloseTo(400, 6) // IT kaybı: UDP enerjisiz
    expect(fault.analysis.nodes.byp1.autoClosed).toBe(false)
    expect(bypass.lostKw).toBe(0)
    expect(bypass.analysis.nodes.byp1.autoClosed).toBe(true)
    expect(bypass.analysis.nodes.udp.energized).toBe(true)
    expect(bypass.changes.some((c) => c.kind === 'autoClose' && /byp1/.test(c.text))).toBe(true)
    expect(bypass.changes[0].kind).toBe('restored')
  })

  it('STS: kaynak kaybında önce yük kaybı, sonra transfer', () => {
    const nodes = [
      grid('g1'), grid('g2'), node('mA', 'mdb'), node('mB', 'mdb'), node('sts', 'sts'), node('it', 'itYuku', { kuruluKw: 200, pf: 1, df: 1 }),
    ]
    const edges = [edge('g1', 'mA'), edge('g2', 'mB'), edge('mA', 'sts', { pay: 100 }), edge('mB', 'sts', { pay: 0 }), edge('sts', 'it')]
    const steps = simulateFailure({ nodes, edges }, ['mA'])
    expect(ids(steps)).toEqual(['normal', 'fault', 'sts'])
    expect(steps[1].lostKw).toBeCloseTo(200, 6) // STS kilitli: A ölü → çıkış yok
    expect(steps[1].analysis.nodes.sts.energized).toBe(false)
    expect(steps[2].lostKw).toBe(0)
    expect(steps[2].changes.some((c) => c.kind === 'transfer' && /mA.*→.*mB/.test(c.text))).toBe(true)
    expect(steps[2].timeLabel).toMatch(/ms/)
  })

  it('jeneratör yokken batarya biter: UPS çıkışı kaybolur', () => {
    const steps = simulateFailure(plant(1, false), ['tx'])
    expect(ids(steps)).toEqual(['normal', 'fault', 'battery'])
    expect(steps[1].analysis.nodes.it.energized).toBe(true) // bataryada
    expect(steps[2].lostKw).toBeCloseTo(500, 6) // IT + chiller
    expect(steps[2].seconds).toBe(60)
    expect(steps[2].timeLabel).toBe('t ≈ 1 dk')
  })

  it('etkisiz arıza (yedek jeneratör) yalnız normal ve arıza adımı üretir', () => {
    const steps = simulateFailure(plant(), ['gen2'])
    expect(ids(steps)).toEqual(['normal', 'fault'])
    expect(steps[1].lostKw).toBe(0)
  })

  it('arıza adımında değişen ekipman vurgulanır', () => {
    const steps = simulateFailure(plant(), ['ups'])
    expect(steps[1].changedNodes).toContain('ups')
    expect(steps[2].changedNodes).toEqual(expect.arrayContaining(['byp1', 'byp2', 'udp']))
  })

  it('son adım, tüm otomasyon açık kararlı duruma eşittir', () => {
    const last = simulateFailure(plant(), ['tx']).at(-1)!
    expect(last.analysis.nodes.msb.energized).toBe(true)
    expect(last.lostKw).toBe(0)
  })
})

describe('arıza giderme (geri dönüş) simülasyonu', () => {
  it('trafo arızası giderilince: jeneratör yükte kalır → şebekeye geri transfer → jeneratör durur', () => {
    const m = plant()
    const steps = simulateFailure(m, ['tx'])
    const staging = steps.find((x) => x.id === 'staging') ?? steps.find((x) => x.id === 'gen')!
    const rec = simulateRecovery(m, staging, ['tx'])
    expect(ids(rec)).toEqual(['clear', 'retransfer', 'genStop'])
    expect(rec.every((x) => x.phase === 'recovery')).toBe(true)
    const [clear, retransfer, stop] = rec
    // Arıza giderildi ama henüz transfer olmadı: trafo enerjili, yük hâlâ jeneratörde.
    expect(clear.analysis.nodes.tx.failed).toBe(false)
    expect(clear.analysis.nodes.tx.energized).toBe(true)
    expect(clear.changes[0].kind).toBe('cleared')
    // Geri transfer: yük trafoda, jeneratör yüksüz çalışır.
    expect(retransfer.analysis.nodes.gen1.totalKw).toBeLessThan(0.5)
    expect(retransfer.analysis.nodes.gen1.running).toBe(true)
    expect(retransfer.analysis.nodes.tx.totalKw).toBeGreaterThan(400)
    // Soğutma sonrası jeneratör durur ve sistem normal duruma döner.
    expect(stop.analysis.nodes.gen1.running).toBeFalsy()
    expect(stop.changes.some((c) => c.kind === 'genStop')).toBe(true)
    expect(Math.round(stop.analysis.totals.totalKw)).toBe(Math.round(steps[0].analysis.totals.totalKw))
    expect(stop.lostKw).toBe(0)
  })

  it('UPS arızası giderilince bypass kesicileri geri açılır, yük UPS\'e döner', () => {
    const m = plant()
    const steps = simulateFailure(m, ['ups'])
    const bypassStep = steps.find((x) => x.id === 'bypass')!
    expect(bypassStep.analysis.nodes.byp1.autoClosed).toBe(true)
    const rec = simulateRecovery(m, bypassStep, ['ups'])
    expect(rec[0].id).toBe('clear')
    // Giderilince bypass geri transfer gecikmesi dolana kadar kapalı kalır.
    expect(rec[0].analysis.nodes.byp1.autoClosed).toBe(true)
    const last = rec[rec.length - 1]
    expect(last.analysis.nodes.byp1.autoClosed).toBe(false)
    expect(last.analysis.nodes.ups.totalKw).toBeGreaterThan(300)
    // Jeneratör hiç çalışmadığı için duruş adımı yok.
    expect(ids(rec)).not.toContain('genStop')
  })

  it('arıza anından hemen giderilirse tek adım (clear) ile normale döner', () => {
    const m = plant()
    const steps = simulateFailure(m, ['chiller'])
    const rec = simulateRecovery(m, steps[1], ['chiller'])
    expect(rec[0].id).toBe('clear')
    expect(rec[rec.length - 1].lostKw).toBe(0)
  })

  it('birden çok arıza: yalnız seçilen ekipmanın arızası giderilir, diğeri sürer', () => {
    const m = plant()
    const steps = simulateFailure(m, ['tx', 'gen1'])
    const last = steps[steps.length - 1]
    expect(last.failed).toEqual(['tx', 'gen1'])
    expect(last.analysis.nodes.gen2.totalKw).toBeGreaterThan(400) // gen1 arızalı: gen2 tek başına taşır

    const rec = simulateRecovery(m, last, ['gen1'])
    expect(rec[0].id).toBe('clear')
    expect(rec.every((r) => r.failed.length === 1 && r.failed[0] === 'tx')).toBe(true)
    expect(rec.every((r) => r.analysis.nodes.tx.failed && !r.analysis.nodes.gen1.failed)).toBe(true)
    // Onarılan jeneratör hemen çalışmaz; trafo arızalı olduğundan yük jeneratörlerde kalır.
    expect(rec[0].analysis.nodes.gen1.running).toBeFalsy()
    expect(rec[0].changes[0]).toMatchObject({ kind: 'cleared' })
    expect(rec[0].changes[0].text).toContain('gen1')
    const end = rec[rec.length - 1]
    expect(end.lostKw).toBe(0)
    const carriers = ['gen1', 'gen2'].filter((g) => end.analysis.nodes[g].totalKw > 400)
    expect(carriers).toHaveLength(1)
    expect(end.running).toContain(carriers[0]) // yük taşıyan jeneratör durmaz

    // Kalan arıza da (trafo) giderilebilir: jeneratörler durur, sistem normale döner.
    const rec2 = simulateRecovery(m, end, ['tx'])
    const fin = rec2[rec2.length - 1]
    expect(fin.failed).toEqual([])
    expect(fin.running).toEqual([])
    expect(Math.round(fin.analysis.totals.totalKw)).toBe(Math.round(steps[0].analysis.totals.totalKw))
  })
})
