import { describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { DEFAULT_SETTINGS, cloneSettings } from '../model/settings'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { energyReport } from './energy'
import { maintenanceScan, redundancyReport } from './redundancy'

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
const tx = (id: string, kva = 1000) => node(id, 'trafo', { nominalKva: kva, primerGerilim: 400, sekonderGerilim: 400, uk: 6, bostaKayip: 0, yukKayip: 0 })

/** Tek hat: şebeke → TX → MDB → yük. */
const single = () => ({
  nodes: [node('g', 'sebeke', { gerilim: 400 }), tx('tx'), node('m', 'mdb'), node('l', 'itYuku', { kuruluKw: 600, pf: 1, df: 1 })],
  edges: [edge('g', 'tx'), edge('tx', 'm'), edge('m', 'l')],
})

/** 2N: iki bağımsız şebeke/TX/MDB; yük iki MDB'den çift kablolu. */
const twoN = () => ({
  nodes: [
    node('g1', 'sebeke', { gerilim: 400 }), tx('tx1'), node('m1', 'mdb'),
    node('g2', 'sebeke', { gerilim: 400 }), tx('tx2'), node('m2', 'mdb'),
    node('l', 'itYuku', { kuruluKw: 600, pf: 1, df: 1 }),
  ],
  edges: [edge('g1', 'tx1'), edge('tx1', 'm1'), edge('m1', 'l'), edge('g2', 'tx2'), edge('tx2', 'm2'), edge('m2', 'l')],
})

describe('kapasite ve yedeklilik özeti', () => {
  it('tek hat: her ekipman tekil arıza noktası, N-1 başarısız', () => {
    const r = redundancyReport(single())
    expect(r.checks.find((c) => c.id === 'n1')!.status).toBe('fail')
    expect(r.spof.filter((x) => x.kind === 'node').map((x) => x.id).sort()).toEqual(['g', 'm', 'tx'])
    expect(r.survived).toBeLessThan(r.total)
    expect(r.checks.find((c) => c.id === 'gen')!.status).toBe('warn') // jeneratör yok
  })

  it('2N: tek arıza yük kaybettirmez; trafo doluluğu %30 → tek arızada %60 (ok)', () => {
    const r = redundancyReport(twoN())
    expect(r.checks.find((c) => c.id === 'n1')!.status).toBe('ok')
    expect(r.spof).toHaveLength(0)
    const t = r.checks.find((c) => c.id === 'trafo')!
    expect(t.status).toBe('ok')
    expect(t.detail).toMatch(/%30/) // normal: 600/2/1000 = %30
    expect(t.detail).toMatch(/%60/) // tek arıza: 600/1000 = %60 (aşırı yük değil)
  })

  it('trafo tek arızada aşırı yüklenirse uyarı detayı belirtir', () => {
    const f = twoN()
    f.nodes.find((n) => n.id === 'l')!.params.kuruluKw = 1400
    const r = redundancyReport(f)
    const t = r.checks.find((c) => c.id === 'trafo')!
    expect(t.status).toBe('warn')
    expect(t.detail).toMatch(/aşırı yük/)
  })

  it('jeneratör N+1: iki jeneratör tek yükü taşır → ok; tek jeneratör → N uyarısı', () => {
    const mk = (n: number) => {
      const f = single()
      f.nodes.push(node('sync', 'senkron'))
      for (let i = 1; i <= n; i++) {
        f.nodes.push(node(`gen${i}`, 'jenerator', { nominalKva: 1000, gerilim: 400, pf: 0.8 }))
        f.edges.push(edge(`gen${i}`, 'sync'))
      }
      f.edges.push(edge('sync', 'm'))
      return f
    }
    const two = redundancyReport(mk(2)).checks.find((c) => c.id === 'gen')!
    expect(two.status).toBe('ok')
    expect(two.detail).toMatch(/N\+1 sağlanıyor/)
    const one = redundancyReport(mk(1)).checks.find((c) => c.id === 'gen')!
    expect(one.detail).toMatch(/Tek jeneratör/)
  })
})

describe('bakım modu', () => {
  it('2N: TX1 bakımda iken yük kaybı yok, ama TX2/MDB2/şebeke2 arızası yük kaybettirir', () => {
    const r = maintenanceScan(twoN(), 'tx1')
    expect(r.maintenanceLostKw).toBe(0)
    expect(r.risky.every((x) => x.lostKw > 500)).toBe(true)
    expect(r.risky.map((x) => x.label)).toEqual(expect.arrayContaining(['g2', 'tx2', 'm2']))
    expect(r.safe).toBeGreaterThan(0)
  })

  it('tek hat: bakım yük kaybettirir', () => {
    expect(maintenanceScan(single(), 'tx').maintenanceLostKw).toBeCloseTo(600, 6)
  })
})

describe('yük profili, enerji ve maliyet', () => {
  const m = {
    nodes: [node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), node('it', 'itYuku', { kuruluKw: 400, pf: 1, df: 1 }), node('c', 'mekanikYuk', { kuruluKw: 100, pf: 1, df: 1, kategori: 'Mekanik' })],
    edges: [edge('g', 'm'), edge('m', 'it'), edge('m', 'c')],
  }
  it('düz profil: günlük 12 000 kWh, PUE 1,25', () => {
    const e = energyReport(m, DEFAULT_SETTINGS)
    expect(e.daily.totalKwh).toBeCloseTo(24 * 500, 6)
    expect(e.avgPue).toBeCloseTo(1.25, 9)
    expect(e.annual.cost).toBeCloseTo(24 * 500 * 365 * 3.5, 3)
  })

  it('profil: IT yarım gün %50 → günlük 9600 kWh, PUE 1,3333; hedef PUE tasarrufu', () => {
    const s = cloneSettings(DEFAULT_SETTINGS)
    s.profilIt = s.profilIt.map((_, h) => (h < 12 ? 100 : 50))
    s.hedefPue = 1.2
    s.tarife = 2
    const e = energyReport(m, s)
    expect(e.daily.itKwh).toBeCloseTo(12 * 400 + 12 * 200, 6)
    expect(e.daily.totalKwh).toBeCloseTo(7200 + 2400, 6)
    expect(e.avgPue).toBeCloseTo(9600 / 7200, 9)
    expect(e.hours[0].totalKw).toBeCloseTo(500, 6)
    expect(e.hours[20].totalKw).toBeCloseTo(300, 6)
    expect(e.peakKw).toBeCloseTo(500, 6)
    expect(e.saving!.kwh).toBeCloseTo((9600 / 7200 - 1.2) * 7200 * 365, 3)
    expect(e.saving!.cost).toBeCloseTo(e.saving!.kwh * 2, 6)
  })

  it('hedef PUE ortalamanın üstündeyse tasarruf yok; kayıp kalemleri maliyetlenir', () => {
    const s = cloneSettings(DEFAULT_SETTINGS)
    s.hedefPue = 2
    expect(energyReport(m, s).saving).toBeUndefined()
    const lossy = { ...m, nodes: m.nodes.map((n) => (n.id === 'm' ? { ...n, params: { ...n.params, baraUzunluk: 10, baraDirenc: 0.05 } } : n)) }
    const e = energyReport(lossy, s)
    expect(e.topLosses[0].kind).toBe('pano')
    expect(e.topLosses[0].cost).toBeCloseTo(e.topLosses[0].annualKwh * s.tarife, 6)
    expect(e.annual.lossKwh).toBeGreaterThan(0)
  })
})
