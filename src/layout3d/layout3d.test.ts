import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../library/templates'
import { migrate, parseProject, serializeProject } from '../model/project'
import type { Oda3D, Project } from '../model/types'
import { autoLayout, boxesOf, levels } from './autoLayout'
import { defaultDims, dimsOf, rackCount, zoneOf } from './dims'
import { alignGuides, boxOf, bounds, findOverlaps, rectsOverlap, roomAt, snap } from './geometry'
import { heatGrid, heatRgb } from './heat'
import { defaultRoute, polylineLength, routeLengthM, routePoints } from './route'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))

const withLayout = (p: Project): Project => {
  const r = autoLayout(p, 'all')
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] })), odalar3d: r.rooms }
}

describe('boyutlar', () => {
  it('tipik boyutlar kapasiteyle ölçeklenir ve kullanıcı geçersiz kılması kazanır', () => {
    const t = (kva: number) => defaultDims({ type: 'trafo', params: { nominalKva: kva } })
    expect(t(2500).g).toBeCloseTo(2.2, 1)
    expect(t(1000).g).toBeLessThan(t(2500).g)
    expect(dimsOf({ type: 'trafo', params: { nominalKva: 2500 }, yerlesim3d: { x: 0, z: 0, g: 3 } }).g).toBe(3)
  })
  it('rack sırasında kabin sayısı kW/7, genişlik 0,6 m × kabin', () => {
    expect(rackCount({ type: 'rack', params: { kuruluKw: 70 } })).toBe(10)
    expect(defaultDims({ type: 'rack', params: { kuruluKw: 70 } }).g).toBeCloseTo(6, 5)
  })
  it('oda türü isiKonum ve jeneratörden gelir', () => {
    expect(zoneOf({ type: 'jenerator', params: {} })).toBe('jenerator')
    expect(zoneOf({ type: 'crah', params: {} })).toBe('salon')
    expect(zoneOf({ type: 'trafo', params: {} })).toBe('elektrik')
  })
})

describe('geometri', () => {
  const box = (id: string, x: number, z: number, g = 2, d = 1, rot = 0) => boxOf(id, 'mdb', { x, z, rot }, { g, d, y: 2 })
  it('çakışma: temas çakışma değil, örtüşme çakışma, döndürme dikkate alınır', () => {
    expect(rectsOverlap(box('a', 0, 0), box('b', 2, 0))).toBe(false) // yalnız temas
    expect(rectsOverlap(box('a', 0, 0), box('b', 1.9, 0))).toBe(true)
    // 90° dönmüş 2×1 → 1×2: x ekseninde ±0,5, z ekseninde ±1
    const b = bounds(box('a', 0, 0, 2, 1, 90))
    expect(b.maxX - b.minX).toBeCloseTo(1, 5)
    expect(b.maxZ - b.minZ).toBeCloseTo(2, 5)
    expect(rectsOverlap(box('a', 0, 0, 2, 1, 90), box('b', 1.2, 0))).toBe(true)
    expect(rectsOverlap(box('a', 0, 0, 2, 1, 90), box('b', 1.6, 0))).toBe(false)
  })
  it('findOverlaps küçük elemanları (kesici) atlar', () => {
    const k = boxOf('k', 'kesici', { x: 0, z: 0 }, { g: 0.4, d: 0.4, y: 0.6 })
    expect(findOverlaps([box('a', 0, 0), k, box('b', 5, 5)]).size).toBe(0)
    expect([...findOverlaps([box('a', 0, 0), box('b', 1, 0)])].sort()).toEqual(['a', 'b'])
  })
  it('ızgaraya yapışma ve hizalama kılavuzu', () => {
    expect(snap(1.26, 0.1)).toBeCloseTo(1.3, 9)
    expect(snap(1.26, 0)).toBe(1.26)
    const g = alignGuides(box('m', 0.07, 5), [box('o', 0, 0)], [])
    expect(g.dx).toBeCloseTo(-0.07, 9) // merkez/kenar x hizası
    expect(g.guides.some((q) => q.axis === 'x')).toBe(true)
  })
  it('noktanın odası', () => {
    const rooms: Oda3D[] = [{ id: 'r', ad: 'r', tur: 'salon', x: 0, z: 0, g: 10, d: 10, y: 3 }]
    expect(roomAt(rooms, 5, 5)?.id).toBe('r')
    expect(roomAt(rooms, 11, 5)).toBeUndefined()
  })
})

describe('otomatik yerleşim', () => {
  for (const [name, p] of [...TEMPLATES.map((t) => [t.ad, t.build()] as const), ['HDC02', hdc] as const]) {
    it(`${name}: her ekipman yerleşir, odalar üretilir, büyük ekipman çakışmaz`, () => {
      const r = autoLayout(p, 'all')
      expect(Object.keys(r.placements)).toHaveLength(p.nodes.length)
      expect(r.rooms.length).toBeGreaterThan(0)
      const q = withLayout(p)
      expect(findOverlaps(boxesOf(q.nodes))).toEqual(new Set())
      // her ana ekipman kendi odasının içinde
      for (const n of q.nodes) {
        if (n.type === 'kesici' || n.type === 'yardimci') continue
        const room = q.odalar3d!.find((o) => o.id === n.yerlesim3d!.oda)
        expect(room, n.ad).toBeDefined()
        const b = bounds(boxOf(n.id, n.type, n.yerlesim3d!, dimsOf(n)))
        expect(b.minX).toBeGreaterThanOrEqual(room!.x - 1e-6)
        expect(b.maxX).toBeLessThanOrEqual(room!.x + room!.g + 1e-6)
      }
    })
  }
  it('şema seviyesi: kaynak 0, yük en derin; kesici seviye artırmaz', () => {
    const p = TEMPLATES[0].build()
    const lv = levels(p)
    const grid = p.nodes.find((n) => n.type === 'sebeke')!
    expect(lv.get(grid.id)).toBe(0)
    const it = p.nodes.find((n) => n.type === 'itYuku')!
    expect(lv.get(it.id)!).toBeGreaterThan(2)
  })
  it('eksik kipi: yalnız yerleşimi olmayanı mevcut yerleşimin altına koyar', () => {
    const q = withLayout(TEMPLATES[0].build())
    const extra = { ...q.nodes[0], id: 'yeni', ad: 'Yeni', type: 'pompa' as const, params: { ...q.nodes[0].params }, yerlesim3d: undefined }
    const model = { nodes: [...q.nodes, extra], edges: q.edges }
    const r = autoLayout(model, 'missing', q.odalar3d)
    expect(Object.keys(r.placements)).toEqual(['yeni'])
    const maxZ = Math.max(...boxesOf(q.nodes).map((b) => bounds(b).maxZ))
    expect(r.placements.yeni.z).toBeGreaterThan(maxZ)
  })
  it('kesici, bağlı olduğu ekipmanın yanına yerleşir', () => {
    const q = withLayout(hdc)
    const byId = new Map(q.nodes.map((n) => [n.id, n]))
    let near = 0
    let total = 0
    for (const n of q.nodes.filter((x) => x.type === 'kesici')) {
      const e = q.edges.find((x) => x.target === n.id) ?? q.edges.find((x) => x.source === n.id)
      if (!e) continue
      total++
      const other = byId.get(e.target === n.id ? e.source : e.target)!
      if (other.type === 'kesici') continue
      const d = Math.hypot(n.yerlesim3d!.x - other.yerlesim3d!.x, n.yerlesim3d!.z - other.yerlesim3d!.z)
      if (d < dimsOf(other).g / 2 + 12) near++
    }
    expect(near).toBeGreaterThan(total * 0.5)
  })
})

describe('kablo güzergâhı ve uzunluk', () => {
  const a = boxOf('a', 'mdb', { x: 0, z: 0 }, { g: 2, d: 1, y: 2 })
  const b = boxOf('b', 'mdb', { x: 10, z: 4 }, { g: 2, d: 1, y: 2 })
  it('ortogonal güzergâh: tava üzerinden x sonra z', () => {
    const pts = routePoints({}, a, b)
    // A üstü (y=2) → tava (y=3) → x → z → B üstü
    expect(pts[0]).toEqual({ x: 0, y: 2, z: 0 })
    expect(pts[1].y).toBe(3)
    expect(polylineLength(pts)).toBeCloseTo(1 + 10 + 4 + 1, 5)
    expect(routeLengthM(pts)).toBeCloseTo(Math.round(16 * 1.05 * 10) / 10, 5)
  })
  it('kullanıcı ara noktaları varsayılanın yerine geçer; uzunluk ikiye katlanınca kayıp mantığına uygun orantılı', () => {
    const user = routePoints({ guzergah3d: [{ x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 4 }] }, a, b)
    expect(user).toHaveLength(4)
    const far = boxOf('f', 'mdb', { x: 20, z: 8 }, { g: 2, d: 1, y: 2 })
    expect(routeLengthM(routePoints({}, a, far))).toBeGreaterThan(routeLengthM(routePoints({}, a, b)))
  })
  it('aynı x üzerindeki ekipmanda tekrar eden nokta yok; şerit (lane) yüksekliği ayırır', () => {
    const c = boxOf('c', 'mdb', { x: 0, z: 6 }, { g: 2, d: 1, y: 2 })
    expect(defaultRoute(a, c)).toHaveLength(2)
    expect(defaultRoute(a, c, 2)[0].y).toBeGreaterThan(defaultRoute(a, c, 0)[0].y)
  })
})

describe('ısı haritası', () => {
  const room = { x: 0, z: 0, g: 20, d: 10 }
  const at = (g: ReturnType<typeof heatGrid>, x: number, z: number) => g.values[Math.floor(z / g.cell) * g.nx + Math.floor(x / g.cell)]
  it('ısı kaynağı sıcak, uzak serin; soğutma ekleyince düşer', () => {
    const hot = heatGrid(room, [{ x: 10, z: 5, kw: 100 }], [])
    expect(at(hot, 10, 5)).toBeGreaterThan(0.99)
    const cooled = heatGrid(room, [{ x: 10, z: 5, kw: 100 }], [{ x: 11, z: 5, kw: 200 }])
    expect(at(cooled, 10, 5)).toBeLessThan(at(hot, 10, 5))
    expect(at(cooled, 10, 5)).toBeGreaterThan(at(cooled, 19, 9))
  })
  it('renk skalası uçlarda mavi ve kırmızı', () => {
    expect(heatRgb(0)).toEqual([37, 99, 235])
    expect(heatRgb(1)).toEqual([220, 38, 38])
  })
})

describe('dosya biçimi', () => {
  it('yerlesim3d, odalar3d, güzergâh ve görünümler kaydedilir ve geri okunur; 3D alanı olmayan eski dosya açılır', () => {
    const p = withLayout(TEMPLATES[0].build())
    p.edges[0] = { ...p.edges[0], guzergah3d: [{ x: 1, y: 3, z: 2 }], uzunlukKaynak: '3d' }
    p.gorunumler3d = [{ ad: 'Ön', pos: [1, 2, 3], target: [0, 0, 0], ortho: false }]
    const back = parseProject(serializeProject(p))
    expect(back.nodes[0].yerlesim3d).toEqual(p.nodes[0].yerlesim3d)
    expect(back.odalar3d).toEqual(p.odalar3d)
    expect(back.edges[0].guzergah3d).toEqual([{ x: 1, y: 3, z: 2 }])
    expect(back.edges[0].uzunlukKaynak).toBe('3d')
    expect(back.gorunumler3d).toEqual(p.gorunumler3d)
    const old = TEMPLATES[0].build()
    const reopened = migrate(JSON.parse(JSON.stringify(old)))
    expect(reopened.nodes.every((n) => n.yerlesim3d === undefined)).toBe(true)
    expect(reopened.odalar3d).toBeUndefined()
  })
  it('bozuk 3D alanları sessizce atılır', () => {
    const raw = JSON.parse(JSON.stringify(TEMPLATES[0].build()))
    raw.nodes[0].yerlesim3d = { x: 'a', z: 1 }
    raw.odalar3d = [{ id: 'x', g: -1, d: 2, x: 0, z: 0 }, 'bozuk']
    raw.edges[0].guzergah3d = [{ x: 1 }, { x: 1, y: 2, z: 3 }]
    const p = migrate(raw)
    expect(p.nodes[0].yerlesim3d).toBeUndefined()
    expect(p.odalar3d).toEqual([])
    expect(p.edges[0].guzergah3d).toEqual([{ x: 1, y: 2, z: 3 }])
  })
})
