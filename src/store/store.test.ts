import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { EQUIPMENT } from '../library/equipment'
import { EQUIPMENT_TYPES } from '../model/types'
import { listProjectsInDb, loadProjectFromDb, deleteProjectFromDb } from './persistence'
import { useStore } from './useStore'

beforeEach(() => useStore.getState().newProject())

describe('kütüphane', () => {
  it('her ekipman tipi için tanım ve varsayılan değer var', () => {
    for (const t of EQUIPMENT_TYPES) {
      const d = EQUIPMENT[t]
      expect(d, t).toBeDefined()
      for (const f of d.fields) expect(d.defaults[f.key], `${t}.${f.key}`).not.toBeUndefined()
      expect(d.summary(d.defaults)).toBeTruthy()
    }
  })
})

describe('store', () => {
  it('düğüm ekler, varsayılanları kopyalar', () => {
    const id = useStore.getState().addNode('trafo', 20, 40)
    const n = useStore.getState().nodes.find((x) => x.id === id)!
    expect(n.data.params).toEqual(EQUIPMENT.trafo.defaults)
    expect(n.data.params).not.toBe(EQUIPMENT.trafo.defaults)
    expect(n.data.ad).toBe('Trafo 1')
  })

  it('geçerli bağlantıyı kabul eder, geçersizleri reddeder', () => {
    const s = useStore.getState()
    const tr = s.addNode('trafo', 0, 0)
    const mdb = s.addNode('mdb', 0, 100)
    const load = s.addNode('itYuku', 0, 200)
    const grid = s.addNode('sebeke', 0, -100)

    expect(s.isValidConnection({ source: tr, target: mdb, sourceHandle: null, targetHandle: null })).toBe(true)
    expect(s.isValidConnection({ source: tr, target: tr, sourceHandle: null, targetHandle: null })).toBe(false)
    // yük başka ekipmanı besleyemez, şebeke beslenemez
    expect(s.isValidConnection({ source: load, target: mdb, sourceHandle: null, targetHandle: null })).toBe(false)
    expect(s.isValidConnection({ source: tr, target: grid, sourceHandle: null, targetHandle: null })).toBe(false)

    s.onConnect({ source: tr, target: mdb, sourceHandle: null, targetHandle: null })
    expect(useStore.getState().edges).toHaveLength(1)
    // yinelenen hat olmaz
    useStore.getState().onConnect({ source: tr, target: mdb, sourceHandle: null, targetHandle: null })
    expect(useStore.getState().edges).toHaveLength(1)
    // hat gerilimi trafo sekonderinden gelir
    expect(useStore.getState().edges[0].data?.gerilim).toBe(400)
  })

  it('düğüm silinince bağlı hatlar da silinir', () => {
    const s = useStore.getState()
    const a = s.addNode('trafo', 0, 0)
    const b = s.addNode('mdb', 0, 100)
    s.onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null })
    // b seçili (son eklenen)
    useStore.getState().deleteSelection()
    expect(useStore.getState().nodes.map((n) => n.id)).toEqual([a])
    expect(useStore.getState().edges).toHaveLength(0)
  })

  it('proje ve IndexedDB gidiş-dönüşü', async () => {
    const s = useStore.getState()
    const a = s.addNode('ups', 0, 0)
    const b = s.addNode('itYuku', 0, 100)
    s.onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null })
    useStore.getState().updateNodeParam(b, 'kuruluKw', 250)
    useStore.getState().setProjectName('Deneme')
    await useStore.getState().saveToDb()
    expect(useStore.getState().dirty).toBe(false)

    const id = useStore.getState().projectId
    const loaded = await loadProjectFromDb(id)
    expect(loaded?.name).toBe('Deneme')
    expect(loaded?.nodes.find((n) => n.id === b)?.params.kuruluKw).toBe(250)
    expect(loaded?.edges).toHaveLength(1)

    useStore.getState().newProject()
    expect(useStore.getState().nodes).toHaveLength(0)
    useStore.getState().loadProject(loaded!)
    expect(useStore.getState().nodes).toHaveLength(2)

    expect((await listProjectsInDb()).some((p) => p.id === id)).toBe(true)
    await deleteProjectFromDb(id)
    expect(await loadProjectFromDb(id)).toBeUndefined()
  })
})

describe('senaryolar', () => {
  const setup = () => {
    const s = useStore.getState()
    const a = s.addNode('trafo', 0, 0)
    const b = s.addNode('mdb', 0, 100)
    s.onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null })
    return { a, b, edgeId: useStore.getState().edges[0].id }
  }

  it('senaryo ekler ve aktif yapar; arıza ekler / kaldırır', () => {
    const { a } = setup()
    const id = useStore.getState().addScenario({ ad: 'T arıza' })
    expect(useStore.getState().activeScenarioId).toBe(id)
    useStore.getState().setNodeFailed(a, true)
    expect(useStore.getState().scenarios[0].failedNodes).toEqual([a])
    useStore.getState().setNodeFailed(a, false)
    expect(useStore.getState().scenarios[0].failedNodes).toEqual([])
  })

  it('anahtar durumu: senaryo yokken temeli, varken yalnızca senaryoyu değiştirir', () => {
    const { edgeId } = setup()
    useStore.getState().setEdgeState(edgeId, 'acik')
    expect(useStore.getState().edges[0].data?.durum).toBe('acik')
    useStore.getState().setEdgeState(edgeId, 'kapali')

    useStore.getState().addScenario()
    useStore.getState().setEdgeState(edgeId, 'acik')
    expect(useStore.getState().edges[0].data?.durum).toBe('kapali') // temel dokunulmadı
    expect(useStore.getState().scenarios[0].edgeStates).toEqual({ [edgeId]: 'acik' })
    useStore.getState().setEdgeState(edgeId, 'kapali') // temele dönünce fark silinir
    expect(useStore.getState().scenarios[0].edgeStates).toEqual({})
  })

  it('senaryolar kaydedilir ve geri yüklenir; aktif senaryo kaydedilmez', async () => {
    const { a } = setup()
    useStore.getState().addScenario({ ad: 'Kayıtlı', failedNodes: [a] })
    await useStore.getState().saveToDb()
    const id = useStore.getState().projectId
    const loaded = await loadProjectFromDb(id)
    expect(loaded?.scenarios).toHaveLength(1)
    expect(loaded?.scenarios[0].failedNodes).toEqual([a])
    useStore.getState().loadProject(loaded!)
    expect(useStore.getState().activeScenarioId).toBeNull()
    expect(useStore.getState().scenarios[0].ad).toBe('Kayıtlı')
    await deleteProjectFromDb(id)
  })

  it('senaryo silinince aktifse temel duruma döner', () => {
    setup()
    const id = useStore.getState().addScenario()
    useStore.getState().deleteScenario(id)
    expect(useStore.getState().activeScenarioId).toBeNull()
    expect(useStore.getState().scenarios).toHaveLength(0)
  })
})

