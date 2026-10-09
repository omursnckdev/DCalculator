import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import { EQUIPMENT } from '../library/equipment'
import {
  DEFAULT_LINE,
  emptyProject,
  fromProjectEdges,
  fromProjectNodes,
  newId,
  SCHEMA_VERSION,
  toProjectEdges,
  toProjectNodes,
} from '../model/project'
import type {
  EquipmentData,
  EquipmentNode,
  EquipmentType,
  LineData,
  LineEdge,
  ParamValue,
  Project,
  Scenario,
  EdgeState,
} from '../model/types'
import { saveProjectToDb } from './persistence'

/**
 * Kanonik durum React Flow düğüm/kenar dizileridir; proje dosyası bunlardan
 * türetilir (`getProject`). Undo/redo (Faz 5) için tek bir değişim noktası
 * olan `set` çağrıları burada toplanmıştır.
 */
interface State {
  projectId: string
  projectName: string
  createdAt: string
  nodes: EquipmentNode[]
  edges: LineEdge[]
  dirty: boolean
  scenarios: Scenario[]
  /** Canvas ve tüm sonuçların gösterdiği senaryo; null = temel durum (kaydedilmez). */
  activeScenarioId: string | null
  /** loadProject her çağrıldığında artar; canvas görünümü sığdırmak için dinler. */
  viewTick: number

  onNodesChange: (changes: NodeChange<EquipmentNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LineEdge>[]) => void
  onConnect: (c: Connection) => void
  isValidConnection: (c: Connection | LineEdge) => boolean

  addNode: (type: EquipmentType, x: number, y: number) => string
  updateNodeData: (id: string, patch: Partial<Omit<EquipmentData, 'params' | 'kind'>>) => void
  updateNodeParam: (id: string, key: string, value: ParamValue) => void
  updateEdgeData: (id: string, patch: Partial<LineData>) => void
  deleteSelection: () => void
  selectNode: (id: string) => void
  selectEdge: (id: string) => void
  setProjectName: (name: string) => void

  addScenario: (init?: Partial<Omit<Scenario, 'id'>>) => string
  updateScenario: (id: string, patch: Partial<Omit<Scenario, 'id'>>) => void
  deleteScenario: (id: string) => void
  setActiveScenario: (id: string | null) => void
  /** Aktif senaryoda ekipmanı arızalı işaretler / kaldırır. */
  setNodeFailed: (nodeId: string, failed: boolean) => void
  /** Aktif senaryo varsa onun anahtar durumunu, yoksa temel durumu değiştirir. */
  setEdgeState: (edgeId: string, state: EdgeState) => void

  getProject: () => Project
  loadProject: (p: Project) => void
  newProject: () => void
  saveToDb: () => Promise<void>
}

const baseProject = emptyProject()

export const useStore = create<State>((set, get) => ({
  projectId: baseProject.id,
  projectName: baseProject.name,
  createdAt: baseProject.createdAt,
  nodes: [],
  edges: [],
  dirty: false,
  scenarios: [],
  activeScenarioId: null,
  viewTick: 0,

  onNodesChange: (changes) => {
    // Seçim / boyut değişimleri projeyi "kirletmez"; konum ve silme kirletir.
    const meaningful = changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add')
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      dirty: s.dirty || meaningful,
    }))
  },

  onEdgesChange: (changes) => {
    const meaningful = changes.some((c) => c.type === 'remove' || c.type === 'add')
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      dirty: s.dirty || meaningful,
    }))
  },

  isValidConnection: (c) => {
    const { source, target } = c
    if (!source || !target || source === target) return false
    const { nodes, edges } = get()
    const src = nodes.find((n) => n.id === source)
    const dst = nodes.find((n) => n.id === target)
    if (!src || !dst) return false
    if (!EQUIPMENT[src.data.kind].hasOutput || !EQUIPMENT[dst.data.kind].hasInput) return false
    // Aynı iki düğüm arasında yinelenen hat olmasın.
    return !edges.some((e) => e.source === source && e.target === target)
  },

  onConnect: (c) => {
    if (!get().isValidConnection(c)) return
    const { nodes } = get()
    const src = nodes.find((n) => n.id === c.source)!
    // Hat gerilimini kaynağın çıkış gerilimine yaklaştır (kullanıcı değiştirebilir).
    const p = src.data.params
    const v = p.sekonderGerilim ?? p.cikisGerilim ?? p.gerilim
    const data: LineData = { ...DEFAULT_LINE, gerilim: typeof v === 'number' ? v : DEFAULT_LINE.gerilim }
    set((s) => ({
      edges: addEdge<LineEdge>({ ...c, id: newId('hat'), type: 'line', data }, s.edges),
      dirty: true,
    }))
  },

  addNode: (type, x, y) => {
    const def = EQUIPMENT[type]
    const id = newId('d')
    const count = get().nodes.filter((n) => n.data.kind === type).length + 1
    const node: EquipmentNode = {
      id,
      type: 'equipment',
      position: { x, y },
      data: {
        kind: type,
        ad: `${def.label} ${count}`,
        etiket: '',
        grup: '',
        notlar: '',
        params: { ...def.defaults },
      },
      selected: true,
    }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node],
      edges: s.edges.map((e) => ({ ...e, selected: false })),
      dirty: true,
    }))
    return id
  },

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      dirty: true,
    })),

  updateNodeParam: (id, key, value) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n,
      ),
      dirty: true,
    })),

  updateEdgeData: (id, patch) =>
    set((s) => ({
      edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), ...patch } } : e)),
      dirty: true,
    })),

  deleteSelection: () =>
    set((s) => {
      const removed = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id))
      return {
        nodes: s.nodes.filter((n) => !n.selected),
        edges: s.edges.filter((e) => !e.selected && !removed.has(e.source) && !removed.has(e.target)),
        dirty: true,
      }
    }),

  selectNode: (id) =>
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })),
      edges: s.edges.map((e) => ({ ...e, selected: false })),
    })),

  selectEdge: (id) =>
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: false })),
      edges: s.edges.map((e) => ({ ...e, selected: e.id === id })),
    })),

  addScenario: (init) => {
    const id = newId('sen')
    const n = get().scenarios.length + 1
    const sc: Scenario = { id, ad: init?.ad ?? `Senaryo ${n}`, failedNodes: init?.failedNodes ?? [], edgeStates: init?.edgeStates ?? {} }
    set((s) => ({ scenarios: [...s.scenarios, sc], activeScenarioId: id, dirty: true }))
    return id
  },

  updateScenario: (id, patch) =>
    set((s) => ({ scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, ...patch } : x)), dirty: true })),

  deleteScenario: (id) =>
    set((s) => ({
      scenarios: s.scenarios.filter((x) => x.id !== id),
      activeScenarioId: s.activeScenarioId === id ? null : s.activeScenarioId,
      dirty: true,
    })),

  setActiveScenario: (id) => set({ activeScenarioId: id }),

  setNodeFailed: (nodeId, failed) => {
    const { activeScenarioId, scenarios } = get()
    const sc = scenarios.find((x) => x.id === activeScenarioId)
    if (!sc) return
    const set_ = new Set(sc.failedNodes)
    if (failed) set_.add(nodeId)
    else set_.delete(nodeId)
    get().updateScenario(sc.id, { failedNodes: [...set_] })
  },

  setEdgeState: (edgeId, state) => {
    const { activeScenarioId, scenarios, edges } = get()
    const sc = scenarios.find((x) => x.id === activeScenarioId)
    if (!sc) {
      get().updateEdgeData(edgeId, { durum: state })
      return
    }
    const base = edges.find((e) => e.id === edgeId)?.data?.durum ?? 'kapali'
    const next = { ...sc.edgeStates }
    if (state === base) delete next[edgeId]
    else next[edgeId] = state
    get().updateScenario(sc.id, { edgeStates: next })
  },

  setProjectName: (name) => set({ projectName: name, dirty: true }),

  getProject: () => {
    const s = get()
    return {
      schemaVersion: SCHEMA_VERSION,
      id: s.projectId,
      name: s.projectName,
      createdAt: s.createdAt,
      updatedAt: new Date().toISOString(),
      nodes: toProjectNodes(s.nodes),
      edges: toProjectEdges(s.edges),
      scenarios: s.scenarios,
    }
  },

  loadProject: (p) =>
    set((s) => ({
      viewTick: s.viewTick + 1,
      projectId: p.id,
      projectName: p.name,
      createdAt: p.createdAt,
      nodes: fromProjectNodes(p.nodes),
      edges: fromProjectEdges(p.edges),
      scenarios: p.scenarios,
      activeScenarioId: null,
      dirty: false,
    })),

  newProject: () => get().loadProject(emptyProject()),

  saveToDb: async () => {
    await saveProjectToDb(get().getProject())
    set({ dirty: false })
  },
}))
