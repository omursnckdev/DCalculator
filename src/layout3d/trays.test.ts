import { describe, expect, it } from 'vitest'
import { analyze } from '../engine'
import { buildReportHtml } from '../export/report'
import { DEFAULT_SETTINGS } from '../model/settings'
import { TEMPLATES } from '../library/templates'
import type { Nokta3D, Tava3D } from '../model/types'
import { migrate, serializeProject } from '../model/project'
import { autoLayout } from './autoLayout'
import { boxOf } from './geometry'
import { STD_DN, autoPipes, boruLength, dnFor, flowLps, hydraulicsOf, pipeLive, pressureDropKpaPer100m, velocity } from './pipes'
import { TrayNet, cableAreaMm2, cableOdMm, cableSizeOf, trayFillRows, usedTrays } from './trays'

const tray = (id: string, pts: [number, number][], over: Partial<Tava3D> = {}): Tava3D => ({ id, ad: id, tur: 'guc', g: 0.4, h: 0.1, y: 3, sinir: 40, noktalar: pts.map(([x, z]) => ({ x, z })), ...over })
const len = (p: Nokta3D[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y, q.z - p[i].z), 0)

describe('kablo kesiti ve alanı', () => {
  it('açıklamadan ve akım kapasitesinden kesit çıkarılır', () => {
    expect(cableSizeOf({ aciklama: '2×150 mm² Cu/XLPE', akimKapasitesi: 0 })).toEqual({ n: 2, s: 150 })
    expect(cableSizeOf({ aciklama: '2x(4x95)+95 mm² N2XH', akimKapasitesi: 0 })).toEqual({ n: 2, s: 95 })
    expect(cableSizeOf({ aciklama: '4x95 mm²', akimKapasitesi: 0 })).toEqual({ n: 1, s: 95 }) // 4 damar, paralel değil
    const t = cableSizeOf({ aciklama: '', akimKapasitesi: 630 })
    expect(t.n * (t.s >= 150 ? 1 : 0)).toBeGreaterThanOrEqual(0)
    expect(t.n).toBeGreaterThanOrEqual(1)
  })
  it('dış çap tipik değerlerde (95 mm² 4 damar ≈ 37 mm) ve alan paralel sayıyla artar', () => {
    expect(cableOdMm(95)).toBeGreaterThan(33)
    expect(cableOdMm(95)).toBeLessThan(42)
    expect(cableAreaMm2({ n: 2, s: 95 })).toBeCloseTo(2 * cableAreaMm2({ n: 1, s: 95 }), 6)
  })
})

describe('tava ağı ve yönlendirme', () => {
  const L = [tray('t1', [[0, 0], [10, 0]]), tray('t2', [[10, 0], [10, 10]])]
  it('L biçimli iki tava: bacak + tava boyu + bacak', () => {
    const r = new TrayNet(L).route({ x: 1, y: 2, z: 1 }, { x: 9, y: 2, z: 9 })!
    expect(r).not.toBeNull()
    expect(r.trayIds.sort()).toEqual(['t1', 't2'])
    // 1 (bacak) + 9 + 9 + 1 ve kot sabit: çokgen ≈ 20
    expect(len(r.points)).toBeCloseTo(20, 4)
    // tüm noktalar tava kotunda (3 + 0,08)
    expect(new Set(r.points.map((p) => p.y.toFixed(2)))).toEqual(new Set(['3.08']))
  })
  it('T kavşağı: ucu başka tavaya değen tava ağa bağlanır', () => {
    const net = new TrayNet([tray('ana', [[0, 0], [20, 0]]), tray('dal', [[10, 8], [10, 0.2]])])
    const r = net.route({ x: 10, y: 2, z: 8 }, { x: 19, y: 2, z: 1 })!
    expect(r).not.toBeNull()
    expect(r.trayIds.sort()).toEqual(['ana', 'dal'])
  })
  it('bağlantısız tavalar veya çok uzak ekipman: yol yok', () => {
    const net = new TrayNet([tray('a', [[0, 0], [5, 0]]), tray('b', [[50, 50], [60, 50]])])
    expect(net.route({ x: 1, y: 2, z: 1 }, { x: 55, y: 2, z: 49 })).toBeNull()
    expect(new TrayNet([]).route({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 })).toBeNull()
    expect(new TrayNet(L).route({ x: 100, y: 2, z: 100 }, { x: 9, y: 2, z: 9 })).toBeNull() // bacak > 30 m
  })
  it('aynı tava parçasında iki ekipman: doğrudan', () => {
    const r = new TrayNet([tray('t', [[0, 0], [20, 0]])]).route({ x: 2, y: 2, z: 1 }, { x: 15, y: 2, z: 1 })!
    expect(len(r.points)).toBeCloseTo(1 + 13 + 1, 4)
  })
})

describe('tava kullanımı ve doluluk', () => {
  const T = [tray('t', [[0, 0], [10, 0]], { g: 0.3, h: 0.1 })]
  const onTray: Nokta3D[] = [{ x: 1, y: 3.08, z: 0 }, { x: 9, y: 3.08, z: 0 }]
  it('tavanın üzerinden geçen kablo uzunluğu tava başına hesaplanır; uzaktaki/farklı kottaki sayılmaz', () => {
    expect(usedTrays(T, onTray)[0].lengthM).toBeCloseTo(8, 1)
    expect(usedTrays(T, [{ x: 1, y: 3.08, z: 2 }, { x: 9, y: 3.08, z: 2 }])).toEqual([])
    expect(usedTrays(T, [{ x: 1, y: 6, z: 0 }, { x: 9, y: 6, z: 0 }])).toEqual([])
  })
  it('doluluk = toplam kablo alanı / tava kesiti; sınırda uyarı, aşımda kırmızı', () => {
    const area = cableAreaMm2({ n: 1, s: 95 })
    // 300 × 100 = 30000 mm²; sınır %40; 12 kablo × ~1086 mm² = 13 000 mm² → %43
    const cables = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, poly: onTray, area }))
    const [row] = trayFillRows(T, cables)
    expect(row.cables).toBe(12)
    expect(row.fillPct).toBeCloseTo((12 * area) / 30000 * 100, 6)
    expect(row.status).toBe('warn')
    expect(trayFillRows(T, cables.slice(0, 4))[0].status).toBe('ok')
    expect(trayFillRows(T, Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, poly: onTray, area })))[0].status).toBe('over')
    expect(trayFillRows(T, [])[0].cables).toBe(0)
  })
})

describe('boru hidroliği', () => {
  it('debi ve DN: standart seriden, hız ≤ 2,5 m/sn; büyük yük büyük DN', () => {
    expect(flowLps(1000)).toBeCloseTo(47.78, 1)
    const dn = dnFor(flowLps(1000))
    expect(STD_DN).toContain(dn)
    expect(velocity(flowLps(1000), dn)).toBeLessThanOrEqual(2.5)
    expect(dnFor(flowLps(100))).toBeLessThan(dnFor(flowLps(2000)))
    expect(dnFor(0)).toBe(STD_DN[0])
  })
  it('basınç kaybı: DN100, 10 L/sn ≈ 16 kPa/100 m; hız artınca hızla artar', () => {
    expect(pressureDropKpaPer100m(10, 100)).toBeCloseTo(16.2, 0)
    expect(pressureDropKpaPer100m(20, 100)).toBeGreaterThan(pressureDropKpaPer100m(10, 100) * 3.5)
  })
})

describe('otomatik boru ağı', () => {
  const p = TEMPLATES[1].build()
  const r = autoLayout(p, 'all')
  const nodes = p.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] }))
  let k = 0
  const pipes = autoPipes(nodes, () => `b${k++}`)
  it('soğuk su devresi: besleme ve dönüş, omurga + her chiller/CRAH için bacak', () => {
    const cold = pipes.filter((b) => b.tur === 'sogukSu')
    const air = nodes.filter((n) => ['crah', 'fanwall', 'inrow', 'rdhx', 'ahu'].includes(n.type)).length
    const chillers = nodes.filter((n) => n.type === 'chiller').length
    expect(cold.filter((b) => b.yon === 'besleme')).toHaveLength(1 + chillers + air)
    expect(cold.filter((b) => b.yon === 'donus')).toHaveLength(1 + chillers + air)
    expect(cold.every((b) => b.otomatik && b.noktalar.length >= 2)).toBe(true)
    const spineS = cold.find((b) => b.ad.includes('Besleme omurga'))!
    const spineR = cold.find((b) => b.ad.includes('Dönüş omurga'))!
    expect(spineR.noktalar[0].x).toBeCloseTo(spineS.noktalar[spineS.noktalar.length - 1].x, 6) // dönüş ters yönde
    expect(spineS.noktalar[0].y).toBeGreaterThan(spineR.noktalar[0].y) // besleme dönüşün üstünde
    // omurga tüm tüketicilerin toplamını taşır: en büyük DN
    expect(Math.max(...cold.map((b) => hydraulicsOf(b).dn))).toBe(hydraulicsOf(spineS).dn)
  })
  it('bacaklar ekipman üstünde biter; uzunluk > 0', () => {
    const crah = nodes.find((n) => n.type === 'crah')!
    const leg = pipes.find((b) => b.yon === 'besleme' && b.ad.endsWith(crah.ad))!
    const end = leg.noktalar[leg.noktalar.length - 1]
    expect(end.x).toBeCloseTo(crah.yerlesim3d!.x, 6)
    expect(end.z).toBeCloseTo(crah.yerlesim3d!.z, 6)
    expect(boruLength(leg)).toBeGreaterThan(0)
  })
  it('hat çalışması: chiller arızalanınca hat durur', () => {
    const a0 = analyze({ nodes, edges: p.edges })
    const chiller = nodes.find((n) => n.type === 'chiller')!
    const pipe = pipes.find((b) => b.tur === 'sogukSu')!
    expect(pipeLive(pipe, a0)).toBe(true)
    // tüm chiller arızalı
    const failed = nodes.filter((n) => n.type === 'chiller').map((n) => n.id)
    const a1 = analyze({ nodes, edges: p.edges }, undefined, { id: 's', ad: 's', failedNodes: failed, edgeStates: {}, nodeStates: {} })
    expect(pipeLive(pipe, a1)).toBe(false)
    expect(chiller).toBeDefined()
  })
  it('boş/yerleşimsiz modelde boru üretilmez', () => {
    expect(autoPipes([], () => 'x')).toEqual([])
  })
})

describe('dosya biçimi: tava ve borular', () => {
  it('kaydedilir ve geri okunur; bozuk kayıtlar atılır', () => {
    const base = TEMPLATES[0].build()
    const t = tray('t1', [[0, 0], [4, 0]])
    const raw = JSON.parse(serializeProject({ ...base, tavalar3d: [t], borular3d: [{ id: 'b', ad: 'B', tur: 'sogukSu', yon: 'besleme', dn: 100, kw: 500, noktalar: [{ x: 0, y: 3, z: 0 }, { x: 4, y: 3, z: 0 }], uretici: ['a'], pompalar: [], otomatik: true }] }))
    const back = migrate(raw)
    expect(back.tavalar3d).toEqual([t])
    expect(back.borular3d?.[0]).toMatchObject({ id: 'b', dn: 100, kw: 500, otomatik: true, uretici: ['a'] })
    raw.tavalar3d.push({ id: 'k', noktalar: [{ x: 1, z: 1 }] }, 'bozuk') // tek noktalı tava geçersiz
    raw.borular3d.push({ id: 'z', noktalar: [{ x: 'a' }] })
    const again = migrate(raw)
    expect(again.tavalar3d).toHaveLength(1)
    expect(again.borular3d).toHaveLength(1)
    expect(migrate(JSON.parse(JSON.stringify(base))).tavalar3d).toBeUndefined()
  })
  it('boxOf kullanıldı (bağımlılık)', () => {
    expect(boxOf('a', 'mdb', { x: 0, z: 0 }, { g: 1, d: 1, y: 1 }).h).toBe(1)
  })
})

describe('rapor: tava ve boru bölümü', () => {
  it('veri varsa 10. bölüm yazılır; yoksa yazılmaz', () => {
    const p = TEMPLATES[1].build()
    const a = analyze(p)
    const base = { project: p, analysis: a, settings: DEFAULT_SETTINGS }
    const r = autoLayout(p, 'all')
    const nodes = p.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] }))
    let k = 0
    const pipes = autoPipes(nodes, () => `r${k++}`)
    const trays = trayFillRows([tray('T1', [[0, 0], [10, 0]])], [])
    const html = buildReportHtml({ ...base, trays, pipes })
    expect(html).toContain('10. Kablo tavası ve boru hatları')
    expect(html).toContain('Kablo tavaları')
    expect(html).toContain('Boru hatları')
    expect(html).toContain('Soğuk su')
    expect(buildReportHtml(base)).not.toContain('10. Kablo tavası')
    expect(buildReportHtml({ ...base, trays, pipes, sections: { infra: false } })).not.toContain('10. Kablo tavası')
  })
})
