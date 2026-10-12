import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { arcEnergy, arcFlashStudy, curvePoints, ppeCategory, selectivityLimitA, selectivityStudy, tripSettings, tripTime } from './protection'

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
const acb = (inA = 1000, over: Params = {}) => node('acb', 'kesici', { tip: 'ACB', nominalAkim: inA, ...over })
const mccb = (inA = 250, over: Params = {}) => node('mccb', 'kesici', { tip: 'MCCB', nominalAkim: inA, ...over })

describe('kesici açma eğrisi', () => {
  it('ACB varsayılanı: Ir=In, tr=12 sn@6Ir, Isd=6Ir/0,3 sn, Ii=15×In', () => {
    const t = tripSettings(acb(1000))
    expect(t).toMatchObject({ inA: 1000, irA: 1000, trSn: 12, isdA: 6000, tsdSn: 0.3, iiA: 15000 })
    expect(tripTime(t, 1000)).toBe(Infinity) // < 1,05 Ir
    expect(tripTime(t, 3000)).toBeCloseTo(12 * 4, 9) // 12 × (6000/3000)²
    expect(tripTime(t, 6000)).toBe(0.3)
    expect(tripTime(t, 14999)).toBe(0.3)
    expect(tripTime(t, 15000)).toBe(0.02)
  })

  it('MCCB varsayılanı: kısa gecikme yok, Ii = 10×In; özel mod alanları kullanır', () => {
    const t = tripSettings(mccb(250))
    expect(t.isdA).toBe(0)
    expect(t.iiA).toBe(2500)
    expect(tripTime(t, 2499)).toBeCloseTo(12 * Math.pow(1500 / 2499, 2), 9)
    expect(tripTime(t, 2500)).toBe(0.02)
    const c = tripSettings(acb(1000, { korumaModu: 'ozel', irOran: 80, trSn: 5, isdKat: 4, tsdSn: 0.1, iiKat: 0 }))
    expect(c.irA).toBe(800)
    expect(c.isdA).toBe(3200)
    expect(c.iiA).toBe(0)
    expect(tripTime(c, 20000)).toBe(0.1) // ani kapalı
  })

  it('eğri noktaları azalan süreyle sıralanır', () => {
    const pts = curvePoints(tripSettings(acb(1000)), 500, 30000, 60)
    expect(pts.length).toBeGreaterThan(10)
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeLessThanOrEqual(pts[i - 1][1] + 1e-9)
  })
})

describe('seçicilik', () => {
  it('ACB (üst) / MCCB 250 A (alt): seçicilik limiti ≈ 15 kA (ACB ani eşiği)', () => {
    const lim = selectivityLimitA(tripSettings(acb(1000)), tripSettings(mccb(250)), 30000)
    expect(lim).toBeGreaterThan(14500)
    expect(lim).toBeLessThan(15200)
    // hata akımı 12 kA ile sınırlıysa tam seçicilik
    expect(selectivityLimitA(tripSettings(acb(1000)), tripSettings(mccb(250)), 12000)).toBe(12000)
  })

  it('aynı ayarlı iki MCCB seçici değildir (limit ≈ alt cihazın Ir civarı)', () => {
    const lim = selectivityLimitA(tripSettings(mccb(250)), tripSettings(mccb(250)), 30000)
    expect(lim).toBeLessThan(2000)
  })

  it('model: şebeke 20 MVA → ACB → MDB → MCCB → yük: Isc ≈ 28,9 kA, durum "kısmi"', () => {
    ports.clear()
    const m = {
      nodes: [node('g', 'sebeke', { gerilim: 400, kisaDevreMva: 20 }), acb(1000), node('m', 'mdb'), mccb(250), node('l', 'rack', { kuruluKw: 50, pf: 1 })],
      edges: [edge('g', 'acb'), edge('acb', 'm'), edge('m', 'mccb'), edge('mccb', 'l')],
    }
    const a = analyze(m)
    expect(a.nodes.mccb.iscKa).toBeCloseTo(28.9, 0)
    const rows = selectivityStudy(m, a)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ upId: 'acb', downId: 'mccb', status: 'partial' })
    expect(rows[0].limitKa).toBeGreaterThan(14.5)
    expect(rows[0].limitKa).toBeLessThan(15.2)
  })
})

describe('ark flaşı (IEEE 1584-2002, basitleştirilmiş)', () => {
  it('Ibf 20 kA, 415 V, G=32, D=455, 0,5 sn → Ia ≈ 9,9 kA, E ≈ 16 cal/cm²', () => {
    const r = arcEnergy(20, 415, 32, 455, 0.5)
    expect(r.iaKa).toBeCloseTo(9.92, 1)
    expect(r.calPerCm2).toBeGreaterThan(14)
    expect(r.calPerCm2).toBeLessThan(18)
  })

  it('enerji süreyle doğru, mesafeyle ters orantılı artar; PPE sınıfları', () => {
    const a = arcEnergy(20, 415, 32, 455, 0.25).calPerCm2
    expect(arcEnergy(20, 415, 32, 455, 0.5).calPerCm2).toBeCloseTo(2 * a, 9)
    expect(arcEnergy(20, 415, 32, 910, 0.5).calPerCm2).toBeLessThan(arcEnergy(20, 415, 32, 455, 0.5).calPerCm2)
    expect([ppeCategory(1), ppeCategory(3), ppeCategory(7), ppeCategory(20), ppeCategory(35), ppeCategory(60)]).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('model: pano, yukarısındaki ACB’nin açma süresiyle (0,3 sn) hesaplanır; koruma yoksa 2 sn', () => {
    ports.clear()
    const m = {
      nodes: [node('g', 'sebeke', { gerilim: 400, kisaDevreMva: 20 }), acb(1000), node('m', 'mdb'), node('l', 'rack', { kuruluKw: 50, pf: 1 })],
      edges: [edge('g', 'acb'), edge('acb', 'm'), edge('m', 'l')],
    }
    const a = analyze(m)
    const rows = arcFlashStudy(m, a, DEFAULT_SETTINGS)
    const row = rows.find((r) => r.id === 'm')!
    expect(row.protectedBy).toBe('acb')
    expect(row.clearingSec).toBe(0.3)
    expect(row.energy).toBeGreaterThan(0)
    const bare = {
      nodes: [node('g', 'sebeke', { gerilim: 400, kisaDevreMva: 20 }), node('m', 'mdb'), node('l', 'rack', { kuruluKw: 50, pf: 1 })],
      edges: [edge('g', 'm'), edge('m', 'l')],
    }
    ports.clear()
    const r2 = arcFlashStudy(bare, analyze(bare), DEFAULT_SETTINGS).find((r) => r.id === 'm')!
    expect(r2.clearingSec).toBe(2)
    expect(r2.energy).toBeGreaterThan(row.energy * 6) // 2 sn / 0,3 sn
  })
})
