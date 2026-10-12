import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { deratingFactor, harmonicLossFactor, kFactor } from './harmonics'

let seq = 0
const ports = new Map<string, number>()
const next = (k: string) => {
  const v = ports.get(k) ?? 0
  ports.set(k, v + 1)
  return v
}
function node(id: string, type: EquipmentType, params: Params = {}): ProjectNode {
  return { id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...params } }
}
function edge(source: string, target: string): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 1, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '', kaynakPort: next(`${source}:o`), hedefPort: next(`${target}:i`),
  }
}
const plant = (thd: number, ups = false, upsThd = 0) => {
  const nodes = [
    node('g', 'sebeke', { gerilim: 34500 }),
    node('tx', 'trafo', { nominalKva: 1000, primerGerilim: 34500, sekonderGerilim: 400, uk: 6, bostaKayip: 0, yukKayip: 10, eddyOran: 10 }),
    node('m', 'mdb'),
    ...(ups ? [node('u', 'ups', { nominalKva: 1000, nominalKw: 1000, verim: 100, girisPf: 1, girisThd: upsThd })] : []),
    node('l', 'itYuku', { kuruluKw: 500, pf: 1, df: 1, thd }),
  ]
  const edges = ups ? [edge('g', 'tx'), edge('tx', 'm'), edge('m', 'u'), edge('u', 'l')] : [edge('g', 'tx'), edge('tx', 'm'), edge('m', 'l')]
  return { nodes, edges }
}

describe('harmonik / K-faktörü', () => {
  it('K-faktörü: THD 0 → 1; THD %30 → ≈ 4,05 (tipik spektrum)', () => {
    expect(kFactor(0)).toBe(1)
    expect(kFactor(30)).toBeCloseTo(4.05, 1)
    expect(kFactor(60)).toBeGreaterThan(kFactor(30))
  })

  it('kayıp çarpanı ve yük düşürme formülleri (Pec-R = %10, K = 4)', () => {
    expect(harmonicLossFactor(0.1, 4)).toBeCloseTo(1.4 / 1.1, 6)
    expect(deratingFactor(0.1, 4)).toBeCloseTo(Math.sqrt(1.1 / 1.4), 6)
    expect(deratingFactor(0.1, 1)).toBe(1)
  })

  it('doğrusal yükte trafo etkilenmez; harmonikli yükte kayıp artar ve kapasite düşer', () => {
    const lin = analyze(plant(0))
    expect(lin.nodes.tx.derating).toBe(1)
    expect(lin.nodes.tx.kFactor).toBe(1)
    // Yük oranı 0,5 → Pk·0,25 = 2,5 kW
    expect(lin.nodes.tx.ownLossKw).toBeCloseTo(2.5, 6)

    const nl = analyze(plant(30))
    const k = kFactor(30)
    expect(nl.nodes.tx.kFactor).toBeCloseTo(k, 6)
    expect(nl.nodes.tx.derating).toBeCloseTo(deratingFactor(0.1, k), 6)
    expect(nl.nodes.tx.ownLossKw).toBeCloseTo(2.5 * harmonicLossFactor(0.1, k), 6)
    expect(nl.nodes.tx.ownLossKw).toBeGreaterThan(lin.nodes.tx.ownLossKw)
    // doluluk, düşürülmüş kapasiteye göre
    expect(nl.nodes.tx.loadingPct!).toBeCloseTo(((nl.nodes.tx.kva / 1000) / nl.nodes.tx.derating!) * 100, 4)
    expect(nl.nodes.tx.loadingPct!).toBeGreaterThan(lin.nodes.tx.loadingPct!)
    // Σ ısı = çekilen güç korunur
    expect(nl.heat.totalKw).toBeCloseTo(nl.totals.totalKw, 9)
  })

  it('UPS harmonikleri izole eder: trafo UPS giriş THD’sini görür, yük THD’sini değil', () => {
    const a = analyze(plant(40, true, 0))
    expect(a.nodes.tx.kFactor).toBe(1)
    const b = analyze(plant(40, true, 30))
    expect(b.nodes.tx.kFactor).toBeCloseTo(kFactor(30), 6)
  })
})
