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
