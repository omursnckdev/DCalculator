import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan, parseProject, serializeProject } from '../model/project'
import { boxesOf } from './autoLayout'
import { dimsOf } from './dims'
import { boxOf, bounds, findOverlaps, roomAt } from './geometry'
import { applyPlan, tagCandidates } from './plan'
import { wallBlocked, walkStepFloors } from './walk'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const plan = parsePlan(JSON.parse(readFileSync(new URL('../../examples/hdc02-gf.plan.json', import.meta.url), 'utf8')))!

describe('kat planı', () => {
  it('plan dosyası okunur: duvar, oda, ekipman', () => {
    expect(plan.duvarlar.length).toBeGreaterThan(1000)
    expect(plan.odalar.length).toBeGreaterThanOrEqual(10)
    expect(plan.ekipman.length).toBeGreaterThan(50)
    expect(plan.g).toBeGreaterThan(100)
  })
  it('bozuk girdi atılır, geçersiz plan undefined', () => {
    expect(parsePlan(null)).toBeUndefined()
    expect(parsePlan({ duvarlar: 'x' })).toBeUndefined()
    const p = parsePlan({ ad: 'a', duvarlar: [[0, 0, 1, 1], [1, 2], 'x', [0, 0, NaN, 1]], ekipman: [{ etiket: 'A', x: 1, z: 1, g: 1, d: 1 }, { etiket: '', x: 1, z: 1, g: 1, d: 1 }, { etiket: 'B', x: 1, z: 1, g: 0, d: 1 }], odalar: [{ ad: 'o', tur: 'salon', x: 0, z: 0, g: 5, d: 5, y: 3 }, { ad: 'bozuk' }] })!
    expect(p.duvarlar).toHaveLength(1)
    expect(p.ekipman.map((e) => e.etiket)).toEqual(['A'])
    expect(p.odalar).toHaveLength(1)
  })
  it('etiket adayları: Etiket alanı, tam ad, ilk sözcük, parantez öncesi', () => {
    expect(tagCandidates({ ad: 'UPS.PL1.1 (IT UPS)', etiket: '' })).toEqual(['UPS.PL1.1 (IT UPS)', 'UPS.PL1.1', 'UPS.PL1.1 (IT UPS)'.split('(')[0].trim().toUpperCase()].filter((v, i, a) => a.indexOf(v) === i))
    expect(tagCandidates({ ad: 'x', etiket: 'tx.pl1' })[0]).toBe('TX.PL1')
  })
  const r = applyPlan(hdc, plan)
  it('HDC02: etiketi eşleşen ekipman plandaki dikdörtgenin merkezine ve boyutuna oturur', () => {
    expect(r.matched).toBeGreaterThanOrEqual(20)
    const byAd = (ad: string) => hdc.nodes.find((n) => n.ad.split(' ')[0] === ad)!
    for (const [tag, ex] of [['MSB.PL1', plan.ekipman.find((e) => e.etiket === 'MSB.PL1')!], ['TX.PL1', plan.ekipman.find((e) => e.etiket === 'TX.PL1')!], ['UPS.PL1.1', plan.ekipman.find((e) => e.etiket === 'UPS.PL1.1')!]] as const) {
      const l = r.placements[byAd(tag).id]
      expect([l.x, l.z, l.g, l.d], tag).toEqual([ex.x, ex.z, ex.g, ex.d])
      expect(l.elev ?? 0).toBe(0)
    }
  })
  it('her düğüm yerleşir; plan dışı jeneratör/chiller avluda (bina dışında, doğuda), IT yükü veri salonunda', () => {
    for (const n of hdc.nodes) expect(r.placements[n.id], n.ad).toBeDefined()
    for (const n of hdc.nodes.filter((x) => x.type === 'jenerator' || x.type === 'chiller')) {
      const b = bounds(boxOf(n.id, n.type, r.placements[n.id], dimsOf({ ...n, yerlesim3d: r.placements[n.id] })))
      expect(b.minX, n.ad).toBeGreaterThan(plan.g)
    }
    const hall = r.rooms.find((o) => o.tur === 'salon')!
    for (const n of hdc.nodes.filter((x) => x.type === 'itYuku')) {
      const l = r.placements[n.id]
      expect(l.x, n.ad).toBeGreaterThan(hall.x)
      expect(l.x, n.ad).toBeLessThan(hall.x + hall.g + 40) // satır genişliği salona göre sınırlı, taşma sınırlı
      expect(l.z).toBeGreaterThan(hall.z)
    }
  })
  it('plan sonrası hiçbir ekipman çakışmaz (aynı etiketli baralar dolap içinde üst üste kotlarda)', () => {
    const nodes = hdc.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] }))
    const ov = findOverlaps(boxesOf(nodes))
    expect([...ov].map((id) => hdc.nodes.find((n) => n.id === id)!.ad)).toEqual([])
    const bars = hdc.nodes.filter((n) => n.ad.startsWith('STSSB.PL1.1A '))
    expect(new Set(bars.map((n) => r.placements[n.id].elev ?? 0)).size).toBe(bars.length)
  })
  it('şalterler panonun üzerinde (ana ekipmanla aynı yer, ön yüz)', () => {
    const msb = hdc.nodes.find((n) => n.ad === 'MSB.PL1')!
    const lm = r.placements[msb.id]
    const near = hdc.nodes.filter((n) => n.type === 'kesici' && Math.hypot(r.placements[n.id].x - lm.x, r.placements[n.id].z - lm.z) < lm.g! / 2 + 1)
    expect(near.length).toBeGreaterThan(3)
    for (const n of near) expect(r.placements[n.id].mont).toBe(true)
  })
  it('plan odaları kimlik alır ve ekipman odasına atanır', () => {
    expect(r.rooms.every((o) => o.id)).toBe(true)
    const ups = hdc.nodes.find((n) => n.ad.startsWith('UPS.PL1.1'))!
    expect(r.rooms.find((o) => o.id === r.placements[ups.id].oda)?.ad).toBe('UPS / STS odası PL1')
    const tx = hdc.nodes.find((n) => n.ad === 'TX.PL1')!
    expect(roomAt(r.rooms, r.placements[tx.id].x, r.placements[tx.id].z, 0)?.ad).toBe('Trafo odası PL1')
  })
  it('planda olup şemada olmayan etiketler bildirilir (batarya, RMU...)', () => {
    expect(r.unused).toContain('BAT.PL1.1')
    expect(r.unused).not.toContain('MSB.PL1')
  })
  it('plan proje dosyasına yazılır ve geri okunur', () => {
    const q = { ...hdc, plan3d: plan }
    const back = parseProject(serializeProject(q))
    expect(back.plan3d?.duvarlar).toHaveLength(plan.duvarlar.length)
    expect(back.plan3d?.ekipman).toHaveLength(plan.ekipman.length)
  })
})

describe('duvar çarpışması', () => {
  const walls: [number, number, number, number][] = [[10, 0, 10, 20]] // x = 10 duvarı
  it('duvara yakın nokta engelli, uzakta serbest; kapı boşluğundan geçilir', () => {
    expect(wallBlocked(walls, 10.1, 5)).toBe(true)
    expect(wallBlocked(walls, 9.6, 5)).toBe(false)
    expect(wallBlocked(walls, 10, 25)).toBe(false) // duvarın ötesi
    expect(wallBlocked(walls, 10.1, 5, 0.25, 4.5)).toBe(false) // üst katta duvar engel değil
  })
  it('yürüyüş duvarda durur ve duvar boyunca kayar', () => {
    let st = { x: 8, z: 5, h: 0 }
    for (let i = 0; i < 40; i++) st = walkStepFloors([], [], [], st, 0.1, 0, 0.35, walls)
    expect(st.x).toBeLessThan(10)
    const z0 = st.z
    for (let i = 0; i < 10; i++) st = walkStepFloors([], [], [], st, 0.1, 0.1, 0.35, walls)
    expect(st.z).toBeGreaterThan(z0)
    expect(st.x).toBeLessThan(10)
  })
  it('kapı boşluğu: iki duvar arası 1 m açıklıktan geçilir', () => {
    const w: [number, number, number, number][] = [[10, 0, 10, 9.5], [10, 10.5, 10, 20]]
    let st = { x: 8, z: 10, h: 0 }
    for (let i = 0; i < 40; i++) st = walkStepFloors([], [], [], st, 0.1, 0, 0.35, w)
    expect(st.x).toBeGreaterThan(11)
  })
})
