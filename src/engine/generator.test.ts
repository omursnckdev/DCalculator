import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { fuelHours, fuelLph, generatorStudy, sfcAt } from './generator'
import { simulateFailure } from './simulate'

const used = new Map<string, number>()
const port = (k: string) => {
  const n = used.get(k) ?? 0
  used.set(k, n + 1)
  return n
}
function node(id: string, type: EquipmentType, params: Params = {}): ProjectNode {
  return { id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: 0, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...params } }
}
function edge(source: string, target: string): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 1, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '', kaynakPort: port(`${source}:o`), hedefPort: port(`${target}:i`),
  }
}

/** Şebeke ─ ATS ─ MDB ─ 3 yük (öncelik 1/3/5, 200 kW); jeneratör 500 kVA × 0,8 = 400 kW. */
function plant() {
  used.clear()
  const nodes = [
    node('g', 'sebeke', { gerilim: 400 }), node('gen', 'jenerator', { nominalKva: 500, pf: 0.8, gerilim: 400, yakitL: 1000, yakitKullanilabilir: 90 }),
    node('ats', 'ats'), node('mdb', 'mdb'),
    node('a', 'itYuku', { kuruluKw: 200, pf: 1, df: 1, oncelik: 1 }),
    node('b', 'itYuku', { kuruluKw: 200, pf: 1, df: 1, oncelik: 3 }),
    node('c', 'itYuku', { kuruluKw: 200, pf: 1, df: 1, oncelik: 5, kalkisKat: 6 }),
  ]
  const edges = [edge('g', 'ats'), edge('gen', 'ats'), edge('ats', 'mdb'), edge('mdb', 'a'), edge('mdb', 'b'), edge('mdb', 'c')]
  return { nodes, edges }
}

describe('jeneratör yakıtı', () => {
  it('özgül tüketim yükle azalır, tüketim L/saat', () => {
    expect(sfcAt(1)).toBe(210)
    expect(sfcAt(0.1)).toBeGreaterThan(sfcAt(0.75))
    expect(fuelLph(400, 400)).toBeCloseTo((400 * 210) / 840, 6)
    expect(fuelLph(400, 0)).toBe(0)
  })
  it('özerklik = kullanılabilir yakıt / tüketim', () => {
    const g = node('x', 'jenerator', { nominalKva: 500, pf: 0.8, yakitL: 1000, yakitKullanilabilir: 90 })
    expect(fuelHours(g, 400)).toBeCloseTo(900 / 100, 6)
    expect(fuelHours(g, 0)).toBe(Infinity)
  })
})

describe('yük atma', () => {
  const m = plant()
  const sc = { id: 's', ad: 's', failedNodes: ['g'], edgeStates: {}, nodeStates: {} }
  it('kapalıyken jeneratör aşırı yüklenir', () => {
    const a = analyze(m, undefined, sc)
    expect(a.nodes.gen.loadingPct).toBeGreaterThan(100)
  })
  it('açıkken düşük öncelikli yük atılır, kritik yük kalır', () => {
    const a = analyze(m, undefined, sc, undefined, { shed: true })
    expect(a.nodes.c.shed).toBe(true)
    expect(a.nodes.c.energized).toBe(false)
    expect(a.nodes.a.energized).toBe(true)
    expect(a.nodes.b.energized).toBe(true)
    expect(a.nodes.gen.loadingPct).toBeLessThanOrEqual(100.001)
  })
  it('aşırı yük yoksa yük atılmaz', () => {
    const a = analyze(m, undefined, undefined, undefined, { shed: true })
    expect(Object.values(a.nodes).some((r) => r.shed)).toBe(false)
  })
})

describe('generatorStudy', () => {
  it('sıralı yük alma: öncelik grupları, kalkış katı gerilim çökmesini artırır', () => {
    const m = plant()
    const gen = m.nodes.find((n) => n.id === 'gen')!
    gen.params.xd = 15
    const st = generatorStudy(m, DEFAULT_SETTINGS)
    expect(st.rows).toHaveLength(1)
    expect(st.steps.map((x) => x.delaySec)).toEqual([0, 20, 40])
    expect(st.steps[2].surgeKva).toBeGreaterThan(st.steps[1].surgeKva)
    expect(st.steps[2].dipPct).toBeGreaterThan(st.steps[1].dipPct)
    expect(st.rows[0].hours).toBeGreaterThan(0)
  })
})

describe('simülasyonda yük atma ve yakıt', () => {
  it('şebeke arızasında jeneratör aşırı yüklenir: yük atma adımı eklenir', () => {
    const steps = simulateFailure(plant(), ['g'])
    const ids = steps.map((x) => x.id)
    expect(ids).toContain('shed')
    const shed = steps[ids.indexOf('shed')]
    expect(shed.analysis.nodes.c.shed).toBe(true)
    expect(shed.lostKw).toBeGreaterThan(0)
  })
  it('yük atma kapalıysa adım yok', () => {
    const steps = simulateFailure(plant(), ['g'], undefined, undefined, { ...DEFAULT_SETTINGS, yukAtma: false })
    expect(steps.map((x) => x.id)).not.toContain('shed')
  })
  it('yakıt simülasyonu açıkken tank bitince jeneratör durur', () => {
    const m = plant()
    const steps = simulateFailure(m, ['g'], undefined, undefined, { ...DEFAULT_SETTINGS, yakitSimulasyon: true })
    const last = steps[steps.length - 1]
    expect(last.id).toBe('fuel')
    expect(last.analysis.nodes.a.energized).toBe(false)
    expect(last.seconds).toBeGreaterThan(3600)
  })
  it('varsayılanda yakıt adımı yok', () => {
    expect(simulateFailure(plant(), ['g']).map((x) => x.id)).not.toContain('fuel')
  })
})
