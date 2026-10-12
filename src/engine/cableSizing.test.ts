import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { cableStudy, sizeCable, tempFactor } from './cableSizing'

describe('kablo boyutlandırma', () => {
  const base = { voltageV: 400, pf: 0.95, ambientC: 35, grouping: 0.8, dropLimitPct: 3, scSec: 0.5 }

  it('sıcaklık düzeltmesi: 30 °C → 1, 35 °C → √(55/60)', () => {
    expect(tempFactor(30)).toBeCloseTo(1, 9)
    expect(tempFactor(35)).toBeCloseTo(Math.sqrt(55 / 60), 9)
  })

  it('400 A, 100 m, 35 °C, gruplama 0,8, Isc 20 kA/0,5 sn → 1×185 mm² (akım, düşüm %2,5, kısa devre ≥ 99 mm²)', () => {
    const r = sizeCable({ ...base, currentA: 400, lengthM: 100, iscKa: 20 })!
    expect(r.n).toBe(1)
    expect(r.s).toBe(185)
    expect(r.capacityA).toBeCloseTo(542 * Math.sqrt(55 / 60) * 0.8, 6)
    expect(r.dropPct).toBeCloseTo(2.5, 1)
    expect(r.sMinShortCircuit).toBeCloseTo((20000 * Math.sqrt(0.5)) / 143, 6)
  })

  it('uzun hatta gerilim düşümü kesiti büyütür; çok büyük akımda paralel kablo gerekir', () => {
    const long = sizeCable({ ...base, currentA: 400, lengthM: 300 })!
    const short = sizeCable({ ...base, currentA: 400, lengthM: 30 })!
    expect(long.n * long.s).toBeGreaterThan(short.n * short.s)
    expect(long.dropPct).toBeLessThanOrEqual(3)
    const big = sizeCable({ ...base, currentA: 2500, lengthM: 40 })!
    expect(big.n).toBeGreaterThan(1)
    expect(big.capacityA).toBeGreaterThanOrEqual(2500)
  })

  it('kısa devre dayanımı: Isc yüksekse küçük kesit elenir', () => {
    const lowIsc = sizeCable({ ...base, currentA: 60, lengthM: 20, iscKa: 5 })!
    const highIsc = sizeCable({ ...base, currentA: 60, lengthM: 20, iscKa: 60 })!
    expect(highIsc.n * highIsc.s).toBeGreaterThan(lowIsc.n * lowIsc.s)
    expect(highIsc.s * highIsc.n).toBeGreaterThanOrEqual(((60000 / 1) * Math.sqrt(0.5)) / 143 / 1 - 1e-9) // paralel de olsa tek kablo kesiti ≥ Isc/n·√t/k
  })

  it('imkânsız koşul (sınırsız akım) → öneri yok', () => {
    expect(sizeCable({ ...base, currentA: 1e6, lengthM: 10 })).toBeUndefined()
  })

  it('model: yetersiz kapasiteli hat işaretlenir ve öneri verilir', () => {
    let seq = 0
    const ports = new Map<string, number>()
    const next = (k: string) => { const v = ports.get(k) ?? 0; ports.set(k, v + 1); return v }
    const node = (id: string, type: EquipmentType, params: Params = {}): ProjectNode => ({ id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...params } })
    const edge = (source: string, target: string, over: Partial<ProjectEdge> = {}): ProjectEdge => ({
      id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 50, akimKapasitesi: 100, r: 0.2, x: 0.08, gerilim: 400,
      pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '', kaynakPort: next(`${source}:o`), hedefPort: next(`${target}:i`), ...over,
    })
    const m = { nodes: [node('g', 'sebeke', { gerilim: 400, kisaDevreMva: 20 }), node('m', 'mdb'), node('l', 'rack', { kuruluKw: 200, pf: 0.95 })], edges: [edge('g', 'm', { akimKapasitesi: 1e6, tip: 'busbar' }), edge('m', 'l')] }
    const rows = cableStudy(m, analyze(m), DEFAULT_SETTINGS)
    expect(rows).toHaveLength(1) // busbar kapsam dışı
    expect(rows[0].adequate).toBe(false)
    expect(rows[0].reason).toBe('capacity')
    expect(rows[0].rec!.capacityA).toBeGreaterThanOrEqual(rows[0].currentA)
  })
})
