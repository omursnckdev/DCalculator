import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS, cloneSettings } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { analyze } from './analyze'
import { copAt, coolingElectricKw, freeCoolingFraction, monthHourTemps, nominalCop } from './climate'
import { energyReport } from './energy'

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

const chiller = (over: Params = {}) => node('ch', 'chiller', { kuruluKw: 100, pf: 1, df: 1, sogutmaKw: 400, ...over })
const plant = (over: Params = {}) => ({
  nodes: [node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), node('it', 'rack', { kuruluKw: 400, pf: 1, df: 1 }), chiller(over)],
  edges: [edge('g', 'm'), edge('m', 'it'), edge('m', 'ch')],
})
const constT = (t: number) => {
  const s = cloneSettings(DEFAULT_SETTINGS)
  s.iklim = { aylikOrt: Array(12).fill(t), aylikGenlik: Array(12).fill(0), saatlik: null }
  return s
}

describe('iklim modeli', () => {
  it('aylık-saatlik sıcaklık: ortalama ve genlik; 15:00 tepe', () => {
    const t = monthHourTemps({ aylikOrt: Array(12).fill(20), aylikGenlik: Array(12).fill(5), saatlik: null })
    expect(t[0][15]).toBeCloseTo(25, 9)
    expect(t[0][3]).toBeCloseTo(15, 9)
    expect(t[5].reduce((a, b) => a + b, 0) / 24).toBeCloseTo(20, 9)
  })

  it('8760 saatlik veri verilirse aylık-saatlik ortalama kullanılır', () => {
    const hourly = Array.from({ length: 8760 }, (_, i) => (i % 24 === 7 ? 10 : 0))
    const t = monthHourTemps({ aylikOrt: Array(12).fill(0), aylikGenlik: Array(12).fill(0), saatlik: hourly })
    expect(t[3][7]).toBeCloseTo(10, 9)
    expect(t[3][8]).toBe(0)
  })

  it('COP: nominalde kapasite/elektrik; sıcaklık arttıkça %2,5/K düşer, soğukta artar (+%40 sınırı)', () => {
    const c = chiller()
    expect(nominalCop(c)).toBe(4)
    expect(copAt(c, 35)).toBeCloseTo(4, 9)
    expect(copAt(c, 45)).toBeCloseTo(4 * 0.75, 9)
    expect(copAt(c, 25)).toBeCloseTo(4 * 1.25, 9)
    expect(copAt(c, -20)).toBeCloseTo(4 * 1.4, 9)
    expect(copAt(chiller({ cop: 6 }), 35)).toBe(6)
  })

  it('free-cooling payı: üstte 0, altta 1, arada doğrusal; "yok" ise hep 0', () => {
    const c = chiller({ freeCooling: 'var', fcAlt: 2, fcUst: 10 })
    expect(freeCoolingFraction(c, 12)).toBe(0)
    expect(freeCoolingFraction(c, 2)).toBe(1)
    expect(freeCoolingFraction(c, 6)).toBeCloseTo(0.5, 9)
    expect(freeCoolingFraction(chiller(), -5)).toBe(0)
  })

  it('elektrik gücü: 35°C’de 400/4 = 100 kW; 25°C’de 80 kW; free-cooling karışımı', () => {
    const c = chiller({ freeCooling: 'var' })
    expect(coolingElectricKw(c, 400, 400, 35)).toBeCloseTo(100, 9)
    expect(coolingElectricKw(c, 400, 400, 25)).toBeCloseTo(80, 9)
    // 5°C: φ = 0,625 → fc 0,625·0,12·100 = 7,5; kalan 0,375·400/(4·1,4) = 26,786
    expect(coolingElectricKw(c, 400, 400, 5)).toBeCloseTo(7.5 + (0.375 * 400) / 5.6, 6)
    // kısmi yük: yarı ısı yarı elektrik
    expect(coolingElectricKw(chiller(), 200, 400, 35)).toBeCloseTo(50, 9)
  })
})

describe('mevsimsel enerji ve PUE', () => {
  it('sabit 35°C: soğutma 100 kW, toplam 500 kW, PUE 1,25; 25°C’de 480 kW', () => {
    const hot = energyReport(plant(), constT(35))
    expect(hot.climateCoupled).toBe(true)
    expect(hot.hours[0].coolingElecKw).toBeCloseTo(100, 6)
    expect(hot.hours[0].totalKw).toBeCloseTo(500, 6)
    expect(hot.avgPue).toBeCloseTo(1.25, 6)
    const cooler = energyReport(plant(), constT(25))
    expect(cooler.hours[0].totalKw).toBeCloseTo(480, 6)
    expect(cooler.avgPue!).toBeLessThan(hot.avgPue!)
  })

  it('soğuk iklim + free-cooling: PUE belirgin düşer; aylar farklı sıcaklıkta farklı PUE verir', () => {
    const s = cloneSettings(DEFAULT_SETTINGS)
    const fc = plant({ freeCooling: 'var' })
    const e = energyReport(fc, s)
    // Ocak (6°C ort.) Temmuz'dan (25,5°C) çok daha verimli
    expect(e.months[0].pue!).toBeLessThan(e.months[6].pue!)
    expect(e.months[0].freeCoolingPct!).toBeGreaterThan(30)
    expect(e.months[6].freeCoolingPct!).toBe(0)
    const noFc = energyReport(plant(), s)
    expect(e.avgPue!).toBeLessThan(noFc.avgPue!)
    // yıllık = aylıkların toplamı; günlük = yıllık/365
    expect(e.annual.totalKwh).toBeCloseTo(e.months.reduce((a, m) => a + m.totalKwh, 0), 6)
    expect(e.daily.totalKwh * 365).toBeCloseTo(e.annual.totalKwh, 6)
    expect(e.coolingKwh!).toBeGreaterThan(0)
  })

  it('soğutma birimi yoksa iklim etkisizdir (eski davranış)', () => {
    const m = { nodes: [node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), node('it', 'rack', { kuruluKw: 100, pf: 1, df: 1 })], edges: [edge('g', 'm'), edge('m', 'it')] }
    const e = energyReport(m, DEFAULT_SETTINGS)
    expect(e.climateCoupled).toBe(false)
    expect(new Set(e.months.map((x) => Math.round(x.totalKwh / x.days))).size).toBe(1)
  })

  it('WUE: kule suyu = (soğutma ısısı + kompresör) × L/kWh; CO₂ = kWh × faktör', () => {
    const f = plant()
    f.nodes.push(node('tw', 'sogutmaKulesi', { isiPayi: 100, suTuketimi: 2 }))
    f.edges.push(edge('m', 'tw'))
    const s = constT(35)
    s.emisyon = 0.5
    const e = energyReport(f, s)
    // saatte: ısı 400 + kompresör 100 = 500 kWh_th × 2 L = 1000 L/saat → yılda 8 760 m³; kule fan 22 kW elektrik ayrıca
    expect(e.waterM3).toBeCloseTo(500 * 2 * 8760 / 1000, 3)
    expect(e.wue).toBeCloseTo((e.waterM3! * 1000) / e.annual.itKwh, 9)
    expect(e.co2Tons).toBeCloseTo((e.annual.totalKwh * 0.5) / 1000, 9)
  })
})

describe('soğutma zinciri: pompa / kule bağımlılığı', () => {
  const chain = (...extra: ProjectNode[]) => ({
    nodes: [node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), node('it', 'rack', { kuruluKw: 200, pf: 1, df: 1 }), chiller(), ...extra],
    edges: [edge('g', 'm'), edge('m', 'it'), edge('m', 'ch'), ...extra.map((n) => edge('m', n.id))],
  })
  const failScenario = (id: string) => ({ id: 's', ad: 's', failedNodes: [id], edgeStates: {}, nodeStates: {} })

  it('iki asıl pompadan biri arızalanınca chiller kapasitesi yarıya iner; yedek pompa varsa düşmez', () => {
    const two = chain(node('p1', 'pompa', { gorev: 'asil' }), node('p2', 'pompa', { gorev: 'asil' }))
    expect(analyze(two).cooling!.capacityKw).toBe(400)
    expect(analyze(two, undefined, failScenario('p1')).cooling!.capacityKw).toBe(200)
    expect(analyze(two, undefined, failScenario('p1')).cooling!.chain!.sogukSu).toBe(0.5)
    const nPlus1 = chain(node('p1', 'pompa', { gorev: 'asil' }), node('p2', 'pompa', { gorev: 'yedek' }))
    expect(analyze(nPlus1, undefined, failScenario('p1')).cooling!.capacityKw).toBe(400)
  })

  it('kule arızası ısı atımı kısıtını tetikler; kondenser/soğuk su grupları ayrı', () => {
    const f = chain(node('tw', 'sogutmaKulesi'), node('pk', 'pompa', { pompaTip: 'kondenser' }))
    expect(analyze(f, undefined, failScenario('tw')).cooling!.capacityKw).toBe(0)
    expect(analyze(f, undefined, failScenario('pk')).cooling!.capacityKw).toBe(0)
    expect(analyze(f).cooling!.capacityKw).toBe(400)
  })
})
