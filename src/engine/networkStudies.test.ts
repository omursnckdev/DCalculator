import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { shortCircuit } from './networkStudies'

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

/** Şebeke 500 MVA @34,5 kV → trafo 2000 kVA (uk %6, Pk 16 kW) → MDB → (kesici) → yük. */
function plant(over: { lineKm?: number; cbKa?: number; loadKw?: number } = {}) {
  const nodes = [
    node('g', 'sebeke', { gerilim: 34500, kisaDevreMva: 500 }),
    node('tx', 'trafo', { nominalKva: 2000, primerGerilim: 34500, sekonderGerilim: 400, uk: 6, yukKayip: 16, bostaKayip: 0 }),
    node('mdb', 'mdb'),
    node('cb', 'kesici', { kesmeKa: over.cbKa ?? 0, gerilim: 400 }),
    node('l', 'itYuku', { kuruluKw: over.loadKw ?? 400 * Math.sqrt(3) * 0.4, pf: 1, df: 1 }),
  ]
  const lenM = (over.lineKm ?? 0.1) * 1000
  const edges = [
    edge('g', 'tx', { gerilim: 34500 }),
    edge('tx', 'mdb'),
    edge('mdb', 'cb'),
    edge('cb', 'l', { r: 0.2, x: 0.1, uzunluk: lenM }),
  ]
  return { nodes, edges }
}

describe('kısa devre akımı', () => {
  it('trafo sekonderinde: şebeke 500 MVA + trafo uk %6 → ≈ 45,1 kA (elle hesap)', () => {
    // Zşebeke(AG) = 0,32 mΩ (X/R=10), Ztrafo = 4,8 mΩ (R 0,64 + jX 4,757) → |Z| = 5,119 mΩ → 400/(√3·5,119e-3)
    const isc = shortCircuit(plant())
    expect(isc.mdb).toBeCloseTo(45.1, 1)
  })

  it('hat empedansı akımı düşürür; yük ucunda MDB barasından küçüktür', () => {
    const isc = shortCircuit(plant())
    expect(isc.l).toBeLessThan(isc.mdb)
    // 100 m, R 0,02 Ω + X 0,01 Ω eklenir → ≈ 8,3 kA
    expect(isc.l).toBeCloseTo(400 / (Math.sqrt(3) * Math.hypot(0.000672 + 0.02, 0.005075 + 0.01)) / 1000, 1)
  })

  it('arızalı kaynak: kısa devre katkısı yok', () => {
    const f = plant()
    const isc = shortCircuit(f, { id: 's', ad: 's', failedNodes: ['g'], edgeStates: {}, nodeStates: {} })
    expect(isc.mdb).toBeUndefined()
  })

  it('jeneratör katkısı: paralel kaynak kısa devre akımını artırır', () => {
    const f = plant()
    f.nodes.push(node('gen', 'jenerator', { nominalKva: 1000, gerilim: 400, xd: 15 }))
    f.edges.push(edge('gen', 'mdb'))
    const without = shortCircuit(plant()).mdb
    const withGen = shortCircuit(f).mdb
    // Xd'' = %15 → Z = 0,15·0,16 = 24 mΩ → 9,6 kA
    expect(withGen - without).toBeGreaterThan(8)
    expect(withGen - without).toBeLessThan(10.5)
  })

  it('kesici kesme kapasitesi aşılırsa hata; 0 = belirtilmedi', () => {
    const bad = analyze(plant({ cbKa: 25 }))
    expect(bad.issues.some((i) => i.severity === 'error' && i.nodeId === 'cb' && /kesme kapasitesi/.test(i.message))).toBe(true)
    const ok = analyze(plant({ cbKa: 65 }))
    expect(ok.issues.some((i) => i.nodeId === 'cb' && /kesme kapasitesi/.test(i.message))).toBe(false)
    const none = analyze(plant({ cbKa: 0 }))
    expect(none.issues.some((i) => i.nodeId === 'cb' && /kesme kapasitesi/.test(i.message))).toBe(false)
    expect(none.nodes.cb.iscKa).toBeGreaterThan(40)
  })
})

describe('toplam gerilim düşümü zinciri', () => {
  it('trafo + hat düşümleri toplanır: ≈ %3,57', () => {
    const a = analyze(plant())
    // Hat: √3·400·0,1·(0,2·1 + 0,1·0) / 400 V = %3,46; trafo: 0,1386·uR(%0,8)·1 = %0,111
    expect(a.edges['cb>l'].voltageDropPct).toBeCloseTo(3.464, 2)
    expect(a.nodes.l.chainDropPct).toBeCloseTo(3.464 + 0.111, 1)
    expect(a.nodes.mdb.chainDropPct).toBeCloseTo(0.111, 1)
  })

  it('sınır (%5) aşılırsa uyarı', () => {
    const a = analyze(plant({ lineKm: 0.2 })) // hat %6,9
    expect(a.issues.some((i) => i.severity === 'warning' && i.nodeId === 'l' && /toplam gerilim düşümü/.test(i.message))).toBe(true)
    const b = analyze(plant({ lineKm: 0.05 }))
    expect(b.issues.some((i) => i.nodeId === 'l' && /toplam gerilim düşümü/.test(i.message))).toBe(false)
  })
})

describe('soğutma yeterliliği', () => {
  const cool = () => {
    const nodes = [
      node('g', 'sebeke', { gerilim: 400 }),
      node('m', 'mdb'),
      node('it', 'itYuku', { kuruluKw: 400, pf: 1, df: 1 }),
      node('c1', 'mekanikYuk', { kuruluKw: 100, pf: 1, df: 1, sogutmaKw: 300 }),
      node('c2', 'mekanikYuk', { kuruluKw: 100, pf: 1, df: 1, sogutmaKw: 300 }),
    ]
    return { nodes, edges: [edge('g', 'm'), edge('m', 'it'), edge('m', 'c1'), edge('m', 'c2')] }
  }

  it('kapasite 600 kW, ihtiyaç 400 kW → yedek %50, açık yok', () => {
    const a = analyze(cool())
    expect(a.cooling).toBeDefined()
    expect(a.cooling!.capacityKw).toBe(600)
    expect(a.cooling!.demandKw).toBeCloseTo(400, 6)
    expect(a.cooling!.deficitKw).toBe(0)
    expect(a.cooling!.reservePct).toBeCloseTo(50, 6)
  })

  it('bir chiller arızalanınca kapasite 300 kW: 100 kW açık, uyarı ve sıcaklık süresi', async () => {
    const { rideThroughMinutes, riseRateKPerMin } = await import('./cooling')
    const a = analyze(cool(), undefined, { id: 's', ad: 's', failedNodes: ['c1'], edgeStates: {}, nodeStates: {} })
    expect(a.cooling!.capacityKw).toBe(300)
    expect(a.cooling!.deficitKw).toBeCloseTo(100, 6)
    expect(a.issues.some((i) => /Soğutma kapasitesi yetersiz/.test(i.message))).toBe(true)
    const s = { salonHacmi: 2000, isilKutle: 10, izinliArtis: 8 }
    // 1,2 kJ/m³K · 2000 m³ · 10 · 8 K = 192 000 kJ; 100 kW → 1920 s = 32 dk
    expect(rideThroughMinutes(100, s)).toBeCloseTo(32, 6)
    expect(riseRateKPerMin(100, s)).toBeCloseTo(0.25, 6)
    expect(rideThroughMinutes(0, s)).toBe(Infinity)
  })

  it('soğutma birimi tanımlı değilse özet yok', () => {
    const f = cool()
    for (const n of f.nodes) if (n.params.sogutmaKw) n.params.sogutmaKw = 0
    expect(analyze(f).cooling).toBeUndefined()
  })
})
