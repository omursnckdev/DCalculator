import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../library/templates'
import { parseProject, serializeProject } from '../model/project'
import type { Oda3D, Project } from '../model/types'
import { autoLayout, boxesOf } from './autoLayout'
import { dimsOf } from './dims'
import { KAT_YUKSEKLIGI, MAX_DROP, RISER, autoStairs, floorAt, floorOf, floorVisible, slabsOf, stairHeightAt, surfaceHeight } from './floors'
import { boxOf, bounds, findOverlaps, roomAt } from './geometry'
import { defaultRoute, polylineLength } from './route'
import { walkStepFloors } from './walk'
import type { WalkState } from './walk'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const layout = (p: Project) => {
  const r = autoLayout(p, 'all')
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] })), odalar3d: r.rooms }
}

describe('katlı bina yerleşimi', () => {
  const p = layout(TEMPLATES[1].build())
  const room = (tur: string) => p.odalar3d!.find((o) => o.tur === tur)!
  it('veri salonu 1. katta (elev = kat yüksekliği), elektrik odası zeminde, ayak izi aynı', () => {
    expect(room('salon').elev).toBe(KAT_YUKSEKLIGI)
    expect(room('elektrik').elev).toBeUndefined()
    const [a, b] = [room('salon'), room('elektrik')]
    expect([a.x, a.z, a.g, a.d]).toEqual([b.x, b.z, b.g, b.d])
  })
  it('salon ekipmanı 1. kat kotunda, elektrik ekipmanı zeminde', () => {
    for (const n of p.nodes) {
      const l = n.yerlesim3d!
      if (n.type === 'rack' || n.type === 'itYuku' || n.type === 'crah') expect(l.elev, n.type).toBe(KAT_YUKSEKLIGI)
      if (n.type === 'ups' || n.type === 'mdb') expect(l.elev ?? 0, n.type).toBe(0)
    }
  })
  it('jeneratör ve dış ekipman binanın dışında (doğuda), bina ile ≥ 10 m açıklık', () => {
    const bld = room('elektrik')
    for (const n of p.nodes.filter((x) => x.type === 'jenerator' || x.type === 'chiller')) {
      const b = bounds(boxOf(n.id, n.type, n.yerlesim3d!, dimsOf(n)))
      expect(b.minX, n.ad).toBeGreaterThan(bld.x + bld.g + 10)
    }
    // Avlu odaları açık ve zeminde
    for (const t of ['jenerator', 'dis'] as const) {
      const r = p.odalar3d!.find((o) => o.tur === t)
      if (r) expect(r.elev).toBeUndefined()
    }
  })
  it('kat ayrımı çakışma üretmez', () => {
    expect(findOverlaps(boxesOf(p.nodes)).size).toBe(0)
  })
  it('şalterler panoyla aynı katta (kot = pano kotu + yükseklik)', () => {
    const q = layout(hdc)
    const byId = new Map(q.nodes.map((n) => [n.id, n]))
    for (const n of q.nodes.filter((x) => x.type === 'kesici')) {
      const e = q.edges.find((x) => x.target === n.id) ?? q.edges.find((x) => x.source === n.id)
      const other = e && byId.get(e.target === n.id ? e.source : e.target)
      if (!other || other.type === 'kesici') continue
      expect(Math.abs((n.yerlesim3d!.elev ?? 0) - (other.yerlesim3d!.elev ?? 0)), n.ad).toBeLessThan(3)
    }
  })
  it('oda kotu serileşir ve yeniden okunur; 0 ise yazılmaz', () => {
    const q = layout(hdc)
    const r = parseProject(serializeProject(q))
    expect(r.odalar3d!.find((o) => o.tur === 'salon')!.elev).toBe(KAT_YUKSEKLIGI)
    expect(JSON.stringify(serializeProject(q))).not.toContain('"elev":0,')
  })
})

describe('katlar: oda ve görünürlük', () => {
  const low: Oda3D = { id: 'a', ad: 'a', tur: 'elektrik', x: 0, z: 0, g: 10, d: 10, y: 3.5 }
  const up: Oda3D = { ...low, id: 'b', tur: 'salon', elev: 4.5 }
  it('roomAt kota göre ayırt eder', () => {
    expect(roomAt([low, up], 5, 5, 0)?.id).toBe('a')
    expect(roomAt([low, up], 5, 5, 4.5)?.id).toBe('b')
    expect(roomAt([low, up], 5, 5, 4.9)?.id).toBe('b')
    expect(roomAt([low, up], 5, 5)?.id).toBe('a')
    expect(roomAt([low, up], 50, 5, 0)).toBeUndefined()
  })
  it('kat numarası ve süzgeç', () => {
    expect(floorOf(0)).toBe(0)
    expect(floorOf(2.2)).toBe(0)
    expect(floorOf(4.5)).toBe(1)
    expect(floorOf(9.2)).toBe(2)
    expect(floorVisible('tum', 4.5)).toBe(true)
    expect(floorVisible('zemin', 4.5)).toBe(false)
    expect(floorVisible('kat1', 0.9)).toBe(false)
    expect(floorVisible('kat1', 4.5)).toBe(true)
  })
  it('döşemeler yalnız üst katlar', () => {
    expect(slabsOf([low, up]).map((s) => s.roomId)).toEqual(['b'])
  })
})

describe('merdiven ve yüzey yüksekliği', () => {
  const rooms: Oda3D[] = [
    { id: 'a', ad: 'a', tur: 'elektrik', x: 0, z: 0, g: 20, d: 12, y: 3.5 },
    { id: 'b', ad: 'b', tur: 'salon', x: 0, z: 0, g: 20, d: 12, y: 4, elev: KAT_YUKSEKLIGI },
  ]
  const stairs = autoStairs(rooms)
  const s = stairs[0]
  it('üst kat başına bir merdiven; üst ucu döşeme kenarına değer; yükselti ≈ 0,18', () => {
    expect(stairs).toHaveLength(1)
    expect(s.x + s.run).toBeCloseTo(0, 6)
    expect(s.elev1).toBe(KAT_YUKSEKLIGI)
    expect(s.run / Math.round(KAT_YUKSEKLIGI / RISER)).toBeCloseTo(0.28, 2)
    expect(autoStairs([rooms[0]])).toHaveLength(0)
  })
  it('merdiven yüksekliği doğrusal artar, yan dışında null', () => {
    expect(stairHeightAt(s, s.x, s.z)).toBeCloseTo(0, 6)
    expect(stairHeightAt(s, s.x + s.run / 2, s.z)).toBeCloseTo(KAT_YUKSEKLIGI / 2, 6)
    expect(stairHeightAt(s, s.x + s.run, s.z)).toBeCloseTo(KAT_YUKSEKLIGI, 6)
    expect(stairHeightAt(s, s.x + 1, s.z + s.g)).toBeNull()
    expect(stairHeightAt(s, s.x - 0.5, s.z)).toBeNull()
  })
  it('yüzey: zemin 0, üst kat 4,5, bina altında ayak zeminde kalır', () => {
    expect(surfaceHeight(rooms, stairs, -20, 40, 0)).toBe(0)
    expect(surfaceHeight(rooms, stairs, 10, 6, 0)).toBe(0) // salon döşemesine adımla çıkılamaz
    expect(surfaceHeight(rooms, stairs, 10, 6, KAT_YUKSEKLIGI)).toBe(KAT_YUKSEKLIGI)
    expect(floorAt(rooms, stairs, 10, 6, 5)).toBe(KAT_YUKSEKLIGI)
    expect(floorAt(rooms, stairs, 10, 6, 1)).toBe(0)
  })
  it('kenardan düşüş engellenir (null)', () => {
    expect(surfaceHeight(rooms, stairs, -3, 40, KAT_YUKSEKLIGI)).toBeNull() // döşeme dışı, 4,5 m düşüş
    expect(surfaceHeight(rooms, stairs, s.x + 3, s.z + 2, 2)).toBeNull() // merdiven yanından
    expect(MAX_DROP).toBeLessThan(1)
  })
  it('yürüyerek merdivenden çıkılır: zeminden başla, +x yönüne yürü → 1. kat', () => {
    let st: WalkState = { x: s.x - 1, z: s.z, h: 0 }
    for (let i = 0; i < 400 && st.h < KAT_YUKSEKLIGI - 1e-6; i++) st = walkStepFloors([], rooms, stairs, st, 0.1, 0)
    expect(st.h).toBeCloseTo(KAT_YUKSEKLIGI, 6)
    expect(st.x).toBeGreaterThanOrEqual(-0.0001)
    // 1. katta devam: döşeme üzerinde kalır
    for (let i = 0; i < 20; i++) st = walkStepFloors([], rooms, stairs, st, 0.1, 0)
    expect(st.h).toBe(KAT_YUKSEKLIGI)
    expect(st.x).toBeGreaterThan(1)
  })
  it('merdivenden yana ve döşeme kenarından dışarı yürünemez; geri inilir', () => {
    let st: WalkState = { x: s.x + s.run / 2, z: s.z, h: KAT_YUKSEKLIGI / 2 }
    const side = walkStepFloors([], rooms, stairs, st, 0, 2)
    expect(side).toEqual(st)
    for (let i = 0; i < 400 && st.h > 1e-6; i++) st = walkStepFloors([], rooms, stairs, st, -0.1, 0)
    expect(st.h).toBeCloseTo(0, 6)
  })
  it('ekipman engeli yalnız aynı kattaki ekipmana', () => {
    const up = boxOf('r', 'rack', { x: 10, z: 6, elev: KAT_YUKSEKLIGI }, { g: 2, d: 1, y: 2.2 })
    const lowBox = boxOf('p', 'mdb', { x: 10, z: 6 }, { g: 2, d: 1, y: 2.2 })
    // zemin katta: üst kat rafı engel değil
    let st = walkStepFloors([up], rooms, stairs, { x: 8, z: 6, h: 0 }, 2, 0)
    expect(st.x).toBeCloseTo(10, 6)
    // zemin katta: zemin ekipmanı engel
    st = walkStepFloors([lowBox], rooms, stairs, { x: 8, z: 6, h: 0 }, 2, 0)
    expect(st.x).toBeLessThan(9)
    // 1. katta: rack engel
    st = walkStepFloors([up], rooms, stairs, { x: 8, z: 6, h: KAT_YUKSEKLIGI }, 2, 0)
    expect(st.x).toBeLessThan(9)
    // 1. katta: zemin ekipmanı engel değil
    st = walkStepFloors([lowBox], rooms, stairs, { x: 8, z: 6, h: KAT_YUKSEKLIGI }, 2, 0)
    expect(st.x).toBeCloseTo(10, 6)
  })
})

describe('katlar arası kablo güzergâhı', () => {
  const lo = boxOf('u', 'ups', { x: 2, z: 2 }, { g: 1, d: 1, y: 2 })
  const hi = boxOf('r', 'rack', { x: 12, z: 8, elev: KAT_YUKSEKLIGI }, { g: 6, d: 1.2, y: 2.2 })
  it('alt kat tavanında yatay, üst ekipmanın arkasından kat şaftı gibi yukarı', () => {
    const pts = defaultRoute(lo, hi)
    expect(pts.length).toBeGreaterThanOrEqual(4)
    // Hiçbir nokta döşemeyi (4,5 m) alt katta kesen yatay yol değil: yatay kısım ≤ 4,2 m, düşey kısım üst ekipman dışında
    expect(Math.max(...pts.slice(0, 2).map((p) => p.y))).toBeLessThan(KAT_YUKSEKLIGI)
    expect(pts[pts.length - 1].y).toBeGreaterThan(KAT_YUKSEKLIGI + 2)
    expect(polylineLength(pts)).toBeGreaterThan(KAT_YUKSEKLIGI + 10)
  })
  it('yön tersine çevrilince aynı noktalar ters sırada', () => {
    const f = defaultRoute(lo, hi)
    const r = defaultRoute(hi, lo)
    expect(r.map((p) => p.y)).toEqual([...f].reverse().map((p) => p.y))
  })
  it('aynı kattaki hat değişmez (üst kat içi)', () => {
    const a = boxOf('a', 'rack', { x: 0, z: 0, elev: KAT_YUKSEKLIGI }, { g: 2, d: 1, y: 2 })
    const b = boxOf('b', 'rack', { x: 10, z: 4, elev: KAT_YUKSEKLIGI }, { g: 2, d: 1, y: 2 })
    expect(defaultRoute(a, b)).toHaveLength(3)
  })
})
