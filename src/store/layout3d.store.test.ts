import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyze } from '../engine'
import { TEMPLATES } from '../library/templates'
import { toProjectEdges, toProjectNodes } from '../model/project'
import { saveProjectToDb, loadProjectFromDb } from './persistence'
import { undo } from './history'
import { useStore } from './useStore'

const st = useStore.getState
beforeEach(() => st().newProject())

describe('3D yerleşim deposu', () => {
  it('3D\'de eklenen ekipman şemada da vardır ve konumu yazılır; 2D\'de eklenen 3D\'de yerleştirilir', () => {
    const id = st().addNode3d('chiller', 4, 6)
    const n = st().nodes.find((x) => x.id === id)!
    expect(n.data.yerlesim3d).toMatchObject({ x: 4, z: 6 })
    expect(n.position).toBeDefined()
    const id2 = st().addNode('mdb', 10, 10) // 2D'de eklendi
    expect(st().nodes.find((x) => x.id === id2)!.data.yerlesim3d).toBeUndefined()
    st().ensureLayout3d()
    const placed = st().nodes.find((x) => x.id === id2)!.data.yerlesim3d!
    expect(Number.isFinite(placed.x)).toBe(true)
    // mevcut ekipmanın konumu korunur
    expect(st().nodes.find((x) => x.id === id)!.data.yerlesim3d).toMatchObject({ x: 4, z: 6 })
  })

  it('hiçbiri yerleşik değilken tümünü diziler ve oda üretir; autoLayout3d yeniden dizer', () => {
    st().loadProject(TEMPLATES[0].build())
    expect(st().odalar3d).toEqual([])
    st().ensureLayout3d()
    expect(st().nodes.every((n) => n.data.yerlesim3d)).toBe(true)
    expect(st().odalar3d.length).toBeGreaterThan(0)
    st().setLayout3d({ [st().nodes[0].id]: { x: 999, z: 999 } })
    st().autoLayout3d()
    expect(st().nodes[0].data.yerlesim3d!.x).not.toBe(999)
  })

  it('taşıma geri alınır (odalar dahil) ve analizi etkilemez', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      st().loadProject(TEMPLATES[0].build())
      st().ensureLayout3d()
      vi.setSystemTime(Date.now() + 2000)
      const id = st().nodes[0].id
      const before = st().nodes[0].data.yerlesim3d!
      st().setLayout3d({ [id]: { x: before.x + 5 } })
      expect(st().nodes[0].data.yerlesim3d!.x).toBe(before.x + 5)
      undo()
      expect(st().nodes[0].data.yerlesim3d!.x).toBe(before.x)
    } finally {
      vi.useRealTimers()
    }
  })

  it('yerleşim ve odalar proje kaydıyla saklanır ve yeniden yüklenir', async () => {
    st().loadProject(TEMPLATES[0].build())
    st().ensureLayout3d()
    st().saveGorunum3d({ ad: 'Ön', pos: [1, 2, 3], target: [0, 0, 0], ortho: true })
    const p = st().getProject()
    await saveProjectToDb(p)
    const back = (await loadProjectFromDb(p.id))!
    st().newProject()
    st().loadProject(back)
    expect(st().odalar3d).toEqual(p.odalar3d)
    expect(st().gorunumler3d).toHaveLength(1)
    expect(st().nodes.every((n) => n.data.yerlesim3d)).toBe(true)
  })

  it('oda ekle/güncelle/sil; silinen odanın ekipmanı odasız kalır', () => {
    const id = st().addNode3d('mdb', 1, 1)
    const o = st().addOda3d({ ad: 'Oda', tur: 'elektrik', x: 0, z: 0, g: 10, d: 10, y: 3 })
    st().updateOda3d(o, { ad: 'Yeni' })
    expect(st().odalar3d[0].ad).toBe('Yeni')
    st().setLayout3d({ [id]: { oda: o } })
    st().removeOda3d(o)
    expect(st().odalar3d).toHaveLength(0)
    expect(st().nodes.find((n) => n.id === id)!.data.yerlesim3d!.oda).toBeUndefined()
  })
})

describe('hat uzunluğunu 3D\'den alma', () => {
  it('kaynak 3d iken uzunluk yerleşimle değişir; elle iken değişmez; kayıp uzunlukla orantılı', () => {
    st().loadProject(TEMPLATES[0].build())
    st().ensureLayout3d()
    const edge = st().edges.find((e) => e.data!.tip === 'kablo')!
    const manual = edge.data!.uzunluk
    st().setLayout3d({ [edge.target]: { x: st().nodes.find((n) => n.id === edge.target)!.data.yerlesim3d!.x + 30 } })
    expect(st().edges.find((e) => e.id === edge.id)!.data!.uzunluk).toBe(manual) // elle: değişmez
    st().setLengthSource3d([edge.id], '3d')
    const L1 = st().edges.find((e) => e.id === edge.id)!.data!.uzunluk
    expect(L1).not.toBe(manual)
    const tgt = st().nodes.find((n) => n.id === edge.target)!.data.yerlesim3d!
    st().setLayout3d({ [edge.target]: { x: tgt.x + 40 } })
    const L2 = st().edges.find((e) => e.id === edge.id)!.data!.uzunluk
    expect(L2).toBeGreaterThan(L1)
    // geçici ara noktalar uzunluğu günceller
    st().setEdgeRoute3d(edge.id, [{ x: 0, y: 20, z: 0 }])
    expect(st().edges.find((e) => e.id === edge.id)!.data!.uzunluk).not.toBe(L2)
    // hat kaybı uzunlukla orantılı
    const model = () => ({ nodes: toProjectNodes(st().nodes), edges: toProjectEdges(st().edges) })
    const loss = (len: number) => {
      const m = model()
      return analyze({ nodes: m.nodes, edges: m.edges.map((e) => (e.id === edge.id ? { ...e, uzunluk: len } : e)) }).edges[edge.id].lossKw
    }
    expect(loss(200)).toBeCloseTo(loss(100) * 2, 6)
  })
})

describe('kopyalama ve panel tercihleri', () => {
  it('seçili ekipman 1 m kaydırılarak kopyalanır, kopya seçili olur; hat kopyalanmaz', () => {
    const id = st().addNode3d('mdb', 5, 5)
    const ids = st().duplicateSelected3d()
    expect(ids).toHaveLength(1)
    const copy = st().nodes.find((n) => n.id === ids[0])!
    expect(copy.data.ad).toContain('(kopya)')
    expect(copy.data.yerlesim3d).toMatchObject({ x: 6, z: 6 })
    expect(copy.selected).toBe(true)
    expect(st().nodes.find((n) => n.id === id)!.selected).toBe(false)
    // parametre kopyası bağımsız
    st().updateNodeParam(ids[0], 'nominalAkim', 123)
    expect(st().nodes.find((n) => n.id === id)!.data.params.nominalAkim).not.toBe(123)
  })
  it('panel açık/kapalı tercihi saklanır', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
    const { useUiPrefs } = await import('./uiPrefs')
    useUiPrefs.getState().setLeft(false)
    useUiPrefs.getState().setRight(false)
    expect(JSON.parse(mem.get('dcalculator:uiPrefs')!)).toMatchObject({ leftOpen: false, rightOpen: false })
    useUiPrefs.getState().setLeft(true)
    useUiPrefs.getState().setRight(true)
    vi.unstubAllGlobals()
  })
})

describe('kablo tavası ve borular', () => {
  const T = { ad: 'T', tur: 'guc' as const, g: 0.4, h: 0.1, y: 3, sinir: 40 }
  it('tava ekle/güncelle/sil; geri alınır; kaydedilir ve yüklenir', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      st().newProject()
      vi.setSystemTime(Date.now() + 2000)
      const id = st().addTava3d({ ...T, noktalar: [{ x: 0, z: 0 }, { x: 10, z: 0 }] })
      st().updateTava3d(id, { g: 0.6 })
      expect(st().tavalar3d[0].g).toBe(0.6)
      vi.setSystemTime(Date.now() + 2000)
      st().removeTava3d(id)
      expect(st().tavalar3d).toHaveLength(0)
      undo()
      expect(st().tavalar3d).toHaveLength(1)
      const p = st().getProject()
      expect(p.tavalar3d).toHaveLength(1)
      st().newProject()
      st().loadProject(p)
      expect(st().tavalar3d[0].noktalar).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kablolar tavalara yönlendirilir: güzergâh tava kotunda, doluluk hesaplanır; sıfırlama varsayılana döner', async () => {
    const { trayFillFor } = await import('../layout3d/infra')
    const { toProjectEdges: tpe, toProjectNodes: tpn } = await import('../model/project')
    st().loadProject(TEMPLATES[0].build())
    st().ensureLayout3d()
    // tüm ekipmanı kapsayan geniş bir tava ağı: bounding box çevresi
    const ls = st().nodes.map((n) => n.data.yerlesim3d!)
    const x0 = Math.min(...ls.map((l) => l.x)) - 1
    const x1 = Math.max(...ls.map((l) => l.x)) + 1
    const z0 = Math.min(...ls.map((l) => l.z)) - 1
    const z1 = Math.max(...ls.map((l) => l.z)) + 1
    st().addTava3d({ ...T, noktalar: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }, { x: x0, z: z0 }] })
    const r = st().routeCablesViaTrays3d()
    expect(r.total).toBeGreaterThan(0)
    expect(r.routed).toBe(r.total)
    const e = st().edges.find((q) => q.data?.guzergah3d)!
    expect(e.data!.guzergah3d!.every((p) => Math.abs(p.y - 3.08) < 1e-6)).toBe(true)
    const rows = trayFillFor(tpn(st().nodes), tpe(st().edges), st().tavalar3d)
    expect(rows[0].cables).toBeGreaterThan(0)
    expect(rows[0].fillPct).toBeGreaterThan(0)
    st().resetCableRoutes3d()
    expect(st().edges.every((q) => !q.data?.guzergah3d)).toBe(true)
  })

  it('otomatik borular üretilir, tekrar çağırınca elle çizilen korunur; DN yüke göre güncellenir', () => {
    st().loadProject(TEMPLATES[1].build())
    st().ensureLayout3d()
    const manual = st().addBoru3d({ ad: 'Elle', tur: 'sogukSu', yon: 'besleme', dn: 100, dnElle: true, kw: 0, noktalar: [{ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }], uretici: [], pompalar: [], otomatik: false })
    const n1 = st().autoPipes3d()
    expect(n1).toBeGreaterThan(4)
    const n2 = st().autoPipes3d()
    expect(n2).toBe(n1)
    expect(st().borular3d.filter((b) => b.otomatik)).toHaveLength(n1)
    expect(st().borular3d.some((b) => b.id === manual)).toBe(true)
    // DN: elle olmayan boruda yük değişince yeniden seçilir
    const auto = st().borular3d.find((b) => b.otomatik)!
    st().updateBoru3d(auto.id, { kw: 5000 })
    expect(st().borular3d.find((b) => b.id === auto.id)!.dn).toBeGreaterThanOrEqual(250)
    st().updateBoru3d(manual, { kw: 5000 })
    expect(st().borular3d.find((b) => b.id === manual)!.dn).toBe(100) // elle: değişmez
  })
})
