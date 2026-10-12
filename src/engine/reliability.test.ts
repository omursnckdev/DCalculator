import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS, cloneSettings } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { reliabilityReport } from './reliability'
import { compareTemplates } from './reliabilityCompare'

let seq = 0
const ports = new Map<string, number>()
const next = (k: string) => {
  const v = ports.get(k) ?? 0
  ports.set(k, v + 1)
  return v
}
// Her bileşen: MTBF 100 000 h, MTTR 5 h → u = 5/100 005
const REL = { mtbf: 100_000, mttr: 5 }
const u = 5 / 100_005
function node(id: string, type: EquipmentType, params: Params = {}): ProjectNode {
  return { id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...REL, ...params } }
}
function edge(source: string, target: string, over: Partial<ProjectEdge> = {}): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 1, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '', kaynakPort: next(`${source}:o`), hedefPort: next(`${target}:i`), ...over,
  }
}
const noCable = () => {
  const s = cloneSettings(DEFAULT_SETTINGS)
  s.kabloMtbf = 1e15
  s.busbarMtbf = 1e15
  return s
}
const load = () => node('l', 'rack', { kuruluKw: 100 })

describe('erişilebilirlik (güvenilirlik)', () => {
  it('seri zincir: kullanılamazlık = Σ U (3 bileşen); Tier III kıyası', () => {
    const m = { nodes: [node('g', 'sebeke', { gerilim: 400 }), node('t', 'trafo'), node('m', 'mdb'), load()], edges: [edge('g', 't'), edge('t', 'm'), edge('m', 'l')] }
    const r = reliabilityReport(m, noCable())
    expect(r.counts.single).toBe(3 + 3) // 3 ekipman + 3 hat (hat U ≈ 0 ama bileşen)
    expect(r.unavailability).toBeCloseTo(3 * u, 9)
    expect(r.availability).toBeCloseTo(1 - 3 * u, 9)
    expect(r.downtimeMinPerYear).toBeCloseTo(3 * u * 8760 * 60, 3)
    expect(r.tier).toBe('Tier III') // 99,985 % ≥ 99,982
    expect(r.nines).toBeCloseTo(-Math.log10(3 * u), 9)
    expect(r.cutSets[0].order).toBe(1)
    expect(r.perLoad[0].availability).toBeCloseTo(1 - 3 * u, 9)
  })

  it('2N: iki bağımsız zincir → yalnız çift arızalar kesinti verir: 9 u² ; Tier IV', () => {
    const m = {
      nodes: [node('g1', 'sebeke', { gerilim: 400 }), node('t1', 'trafo'), node('m1', 'mdb'), node('g2', 'sebeke', { gerilim: 400 }), node('t2', 'trafo'), node('m2', 'mdb'), load()],
      edges: [edge('g1', 't1'), edge('t1', 'm1'), edge('m1', 'l'), edge('g2', 't2'), edge('t2', 'm2'), edge('m2', 'l')],
    }
    const r = reliabilityReport(m, noCable())
    expect(r.counts.single).toBe(0)
    expect(r.unavailability).toBeCloseTo(9 * u * u, 12)
    expect(r.tier).toBe('Tier IV')
    expect(r.nines).toBeGreaterThan(7)
    expect(r.cutSets.every((c) => c.order >= 2)).toBe(true)
    // yük hattı (m1→l) bileşen olduğundan çiftler arasında hat da var, ama olasılıkları ihmal edilebilir
    expect(r.cutSets[0].share).toBeGreaterThan(5)
  })

  it('jeneratör yedeği: şebeke ∧ jeneratör çifti; jeneratör U = onarım + talepte çalışmama (%1,5)', () => {
    const m = {
      nodes: [node('g', 'sebeke', { gerilim: 400 }), node('gen', 'jenerator'), node('m', 'mdb'), load()],
      edges: [edge('g', 'm'), edge('gen', 'm'), edge('m', 'l')],
    }
    const r = reliabilityReport(m, noCable())
    const ug = u + 0.015
    // tek noktalar: mdb; çift: (şebeke, jeneratör)
    expect(r.unavailability).toBeCloseTo(u + u * ug, 9)
    expect(r.counts.pair).toBeGreaterThanOrEqual(1)
    const pair = r.cutSets.find((c) => c.order === 2 && c.names.includes('g') && c.names.includes('gen'))!
    expect(pair.probability).toBeCloseTo(u * ug, 12)
  })

  it('UPS bypass (otomatik kesici) fazlalık yol sayılır: UPS tek başına tekil nokta değildir', () => {
    const m = {
      nodes: [
        node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), node('ups', 'ups'), node('u', 'upsPanosu'),
        node('byp', 'kesici', { durum: 'acik', otomatik: 'otomatik' }), load(),
      ],
      edges: [edge('g', 'm'), edge('m', 'ups'), edge('ups', 'u'), edge('m', 'byp'), edge('byp', 'u'), edge('u', 'l')],
    }
    const r = reliabilityReport(m, noCable())
    const singles = r.cutSets.filter((c) => c.order === 1).map((c) => c.names[0])
    expect(singles).not.toContain('ups')
    expect(singles).toEqual(expect.arrayContaining(['g', 'm', 'u']))
    // UPS ∧ bypass kesici çifti kesit kümesidir
    expect(r.cutSets.some((c) => c.order === 2 && c.names.includes('ups') && c.names.includes('byp'))).toBe(true)
  })

  it('şablon karşılaştırma: N < N+1 < 2N (erişilebilirlik artar)', () => {
    const rows = compareTemplates(DEFAULT_SETTINGS)
    expect(rows).toHaveLength(3)
    const [n, n1, two] = rows
    expect(n.availability).toBeLessThan(n1.availability)
    expect(n1.availability).toBeLessThan(two.availability)
    expect(n.singles).toBeGreaterThan(two.singles)
    expect(two.nines).toBeGreaterThan(n.nines)
  })
})
