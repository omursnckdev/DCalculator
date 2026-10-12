import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import { EQUIPMENT, MAX_PORTS, portCount } from '../library/equipment'
import {
  DEFAULT_LINE,
  emptyProject,
  fromProjectEdges,
  fromProjectNodes,
  handleId,
  newId,
  portOf,
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
  Params,
  Project,
  ProjectEdge,
  ProjectNode,
  Scenario,
  EdgeState,
  Gorunum3D,
  Nokta3D,
  Oda3D,
  Yerlesim3D,
} from '../model/types'
import { DEFAULT_SETTINGS, cloneSettings } from '../model/settings'
import type { ProjectSettings } from '../model/settings'
import { simulateAdditionalFault, simulateFailure, simulateRecovery } from '../engine'
import type { SimStep } from '../engine'
import { autoLayout } from '../layout3d/autoLayout'
import { lengthPatches } from '../layout3d/lengths'
import { attachHistory } from './history'
import { saveProjectToDb } from './persistence'

/**
 * Kanonik durum React Flow düğüm/kenar dizileridir; proje dosyası bunlardan
 * türetilir (`getProject`). Undo/redo (Faz 5) için tek bir değişim noktası
 * olan `set` çağrıları burada toplanmıştır.
 */
export interface SimState {
  /** Arıza uygulanan ekipman. */
  failed: string[]
  steps: SimStep[]
  /** Giderme dalları: her kayıt, o adımdan arıza giderilmeden önceki adım listesini saklar. */
  history: { at: number; steps: SimStep[] }[]
  index: number
  playing: boolean
  /** Oynatma hızı çarpanı. */
  speed: number
}

export type NodeView = 'icon' | 'card'
const FLOW_KEY = 'dcalculator:flowAnim'
function loadFlow(): boolean {
  try {
    return localStorage.getItem(FLOW_KEY) !== 'off'
  } catch {
    return true
  }
}
const VIEW_KEY = 'dcalculator:nodeView'
function loadView(): NodeView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'card' ? 'card' : 'icon'
  } catch {
    return 'icon'
  }
}

/** `uzunlukKaynak === '3d'` hatların uzunluğunu güncel yerleşimden yeniden hesaplar (değişen yoksa aynı dizi döner). */
function withLengths(nodes: EquipmentNode[], edges: LineEdge[]): LineEdge[] {
  if (!edges.some((e) => e.data?.uzunlukKaynak === '3d')) return edges // sürüklemede ağır dönüşümü atla
  const pe = toProjectEdges(edges)
  const patches = lengthPatches(toProjectNodes(nodes), pe)
  if (Object.keys(patches).length === 0) return edges
  return edges.map((e) => (patches[e.id] !== undefined ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), uzunluk: patches[e.id] } } : e))
}

interface State {
  /** Düğüm gösterimi: 'icon' = ikon + ad (varsayılan), 'card' = ayrıntılı kart. Kişisel tercih, projeye yazılmaz. */
  nodeView: NodeView
  setNodeView: (v: NodeView) => void
  /** Hatlarda akan enerji animasyonu (kişisel tercih). */
  flowAnim: boolean
  setFlowAnim: (v: boolean) => void
  /** Canlı simülasyon (arıza oynatma); null = kapalı. Projeye yazılmaz. */
  sim: SimState | null
  /** Arıza listesine eklenen ekipman (Canlı simülasyon şeridi); şemadan ve panelden doldurulur. */
  simPicked: string[]
  toggleSimPick: (id: string) => void
  setSimPicked: (ids: string[]) => void
  /** Simülasyon şeridi açık mı. */
  simOpen: boolean
  setSimOpen: (v: boolean) => void
  startSim: (failed: string[]) => void
  /** Arızayı seçili adımdan itibaren giderir; sonraki adımlar giderme sürecidir. */
  clearSimFault: (ids?: string[]) => void
  /** Seçili adımdan itibaren ek ekipman arızası uygular (sıralı arıza). */
  addSimFault: (ids: string[]) => void
  setSimIndex: (i: number) => void
  setSimPlaying: (p: boolean) => void
  setSimSpeed: (s: number) => void
  stopSim: () => void
  projectId: string
  projectName: string
  createdAt: string
  nodes: EquipmentNode[]
  edges: LineEdge[]
  dirty: boolean
  scenarios: Scenario[]
  /** Geri al / yinele yığın boyutları (arayüz düğmeleri için). */
  history: { undo: number; redo: number }
  /** Yük profili, tarife ve soğutma ayarları (projeyle kaydedilir). */
  ayarlar: ProjectSettings
  setAyarlar: (patch: Partial<ProjectSettings>) => void
  /** 3D yerleşim: odalar (geri alınabilir) ve kayıtlı kamera görünümleri. */
  odalar3d: Oda3D[]
  gorunumler3d: Gorunum3D[]
  /** Ekipmanların 3D yerleşimini günceller (yerleşimi olmayan düğüm için x,z gerekir). */
  setLayout3d: (patches: Record<string, Partial<Yerlesim3D>>) => void
  /** Yerleşimi olmayan ekipmanı yerleştirir; hiçbiri yerleşik değilse tümünü diziler ve odaları üretir. */
  ensureLayout3d: () => void
  /** Tüm ekipmanı yeniden dizer ve odaları yeniden üretir. */
  autoLayout3d: () => void
  /** 3D sahnede ekipman ekler (x,z metre); şemada ayrıca otomatik bir konum alır. */
  addNode3d: (type: EquipmentType, x: number, z: number, init?: { ad?: string; params?: Params }) => string
  addOda3d: (oda: Omit<Oda3D, 'id'>) => string
  updateOda3d: (id: string, patch: Partial<Omit<Oda3D, 'id'>>) => void
  removeOda3d: (id: string) => void
  saveGorunum3d: (g: Gorunum3D) => void
  removeGorunum3d: (index: number) => void
  /** Hattın 3D ara noktaları (undefined: otomatik güzergâh). */
  setEdgeRoute3d: (edgeId: string, pts: Nokta3D[] | undefined) => void
  /** Hat uzunluğunun kaynağı: '3d' ise güzergâhtan hesaplanır ve yerleşim değiştikçe güncellenir. */
  setLengthSource3d: (edgeIds: string[], source: 'elle' | '3d') => void
  /** Canvas ve tüm sonuçların gösterdiği senaryo; null = temel durum (kaydedilmez). */
  activeScenarioId: string | null
  /** loadProject her çağrıldığında artar; canvas görünümü sığdırmak için dinler. */
  viewTick: number

  onNodesChange: (changes: NodeChange<EquipmentNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LineEdge>[]) => void
  onConnect: (c: Connection) => void
  isValidConnection: (c: Connection | LineEdge) => boolean

  addNode: (type: EquipmentType, x: number, y: number, init?: { ad?: string; params?: Params }) => string
  /** Excel/CSV içe aktarmadan gelen ekipman ve hatları şemaya ekler (yeni düğümler seçili olur). */
  importEquipment: (nodes: ProjectNode[], edges: ProjectEdge[]) => void
  updateNodeData: (id: string, patch: Partial<Omit<EquipmentData, 'params' | 'kind'>>) => void
  updateNodeParam: (id: string, key: string, value: ParamValue) => void
  updateEdgeData: (id: string, patch: Partial<LineData>) => void
  /** Kablo seçim önerisini hatta uygular (direnç, reaktans, akım kapasitesi, açıklama). */
  applyCableSpec: (edgeId: string, spec: { n: number; s: number; r: number; x: number; capacityA: number }) => void
  /** Hattı ekipmanın başka bir boş portuna taşır; başarılıysa true. */
  setEdgePort: (edgeId: string, side: 'source' | 'target', port: number) => boolean
  setPreferredInput: (nodeId: string, edgeId: string) => void
  deleteSelection: () => void
  /** Seçili ekipmanın grup adını ayarlar (boş = gruptan çıkar). */
  setGroupForSelected: (name: string) => void
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
  /** Kesici/ayırıcı düğümün durumu: aktif senaryo varsa onu, yoksa temel durumu değiştirir. */
  setNodeSwitch: (nodeId: string, state: EdgeState) => void

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
  nodeView: loadView(),
  flowAnim: loadFlow(),
  setFlowAnim: (v) => {
    try {
      localStorage.setItem(FLOW_KEY, v ? 'on' : 'off')
    } catch {
      /* tercih kaydedilemedi; sorun değil */
    }
    set({ flowAnim: v })
  },
  sim: null,
  simPicked: [],
  toggleSimPick: (id) =>
    set((s) => ({
      simPicked: s.simPicked.includes(id) ? s.simPicked.filter((x) => x !== id) : [...s.simPicked, id],
      simOpen: true,
    })),
  setSimPicked: (ids) => set({ simPicked: ids }),
  simOpen: true,
  setSimOpen: (v) => set({ simOpen: v }),
  startSim: (failed) => {
    const s = get()
    const model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    const steps = simulateFailure(model, failed, s.scenarios.find((x) => x.id === s.activeScenarioId), undefined, s.ayarlar)
    set({ sim: { failed, steps, history: [], index: 0, playing: false, speed: 1 } })
  },
  clearSimFault: (ids) => {
    const s = get()
    const sim = s.sim
    if (!sim) return
    const from = sim.steps[sim.index]
    if (!from || sim.index === 0 || from.failed.length === 0) return
    const clearIds = (ids ?? from.failed).filter((id) => from.failed.includes(id))
    if (clearIds.length === 0) return
    const model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    const rec = simulateRecovery(model, from, clearIds, s.scenarios.find((x) => x.id === s.activeScenarioId), undefined, s.ayarlar)
    const steps = [...sim.steps.slice(0, sim.index + 1), ...rec]
    set({
      sim: {
        ...sim,
        steps,
        history: [...sim.history, { at: sim.index, steps: sim.steps }],
        index: Math.min(sim.index + 1, steps.length - 1),
        playing: rec.length > 1,
      },
    })
  },
  addSimFault: (ids) => {
    const s = get()
    const sim = s.sim
    if (!sim) return
    const from = sim.steps[sim.index]
    if (!from) return
    const model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    const add = simulateAdditionalFault(model, from, ids, s.scenarios.find((x) => x.id === s.activeScenarioId), undefined, s.ayarlar)
    if (add.length === 0) return
    const steps = [...sim.steps.slice(0, sim.index + 1), ...add]
    set({
      sim: { ...sim, steps, history: [...sim.history, { at: sim.index, steps: sim.steps }], index: Math.min(sim.index + 1, steps.length - 1), playing: add.length > 1 },
    })
  },
  setSimIndex: (i) =>
    set((s) => {
      if (!s.sim) return {}
      // Giderme noktasından önceki bir adıma dönülünce o giderme geri alınır: arıza sürer.
      let steps = s.sim.steps
      let history = s.sim.history
      while (history.length > 0 && i < history[history.length - 1].at) {
        steps = history[history.length - 1].steps
        history = history.slice(0, -1)
      }
      return { sim: { ...s.sim, steps, history, index: Math.max(0, Math.min(steps.length - 1, i)) } }
    }),
  setSimPlaying: (p) => set((s) => (s.sim ? { sim: { ...s.sim, playing: p } } : {})),
  setSimSpeed: (sp) => set((s) => (s.sim ? { sim: { ...s.sim, speed: sp } } : {})),
  stopSim: () => set({ sim: null }),
  setNodeView: (v) => {
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* tercih kaydedilemedi; sorun değil */
    }
    set({ nodeView: v })
  },
  dirty: false,
  scenarios: [],
  history: { undo: 0, redo: 0 },
  ayarlar: cloneSettings(DEFAULT_SETTINGS),
  setAyarlar: (patch) => set((s) => ({ ayarlar: { ...s.ayarlar, ...patch }, dirty: true })),

  odalar3d: [],
  gorunumler3d: [],
  setLayout3d: (patches) =>
    set((s) => {
      const nodes = s.nodes.map((n) => {
        const p = patches[n.id]
        if (!p) return n
        const cur = n.data.yerlesim3d
        const next = { ...(cur ?? { x: 0, z: 0 }), ...p } as Yerlesim3D
        if (!cur && (p.x === undefined || p.z === undefined)) return n
        return { ...n, data: { ...n.data, yerlesim3d: next } }
      })
      return { nodes, edges: withLengths(nodes, s.edges), dirty: true }
    }),
  ensureLayout3d: () => {
    const s = get()
    const model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    const missing = model.nodes.filter((n) => !n.yerlesim3d)
    if (missing.length === 0) return
    const all = missing.length === model.nodes.length
    const r = autoLayout(model, all ? 'all' : 'missing', s.odalar3d)
    set((st) => {
      const nodes = st.nodes.map((n) => (r.placements[n.id] && !n.data.yerlesim3d ? { ...n, data: { ...n.data, yerlesim3d: r.placements[n.id] } } : n))
      return { nodes, edges: withLengths(nodes, st.edges), odalar3d: all ? r.rooms : st.odalar3d, dirty: true }
    })
  },
  autoLayout3d: () => {
    const s = get()
    const r = autoLayout({ nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }, 'all')
    set((st) => {
      const nodes = st.nodes.map((n) => (r.placements[n.id] ? { ...n, data: { ...n.data, yerlesim3d: r.placements[n.id] } } : n))
      return { nodes, edges: withLengths(nodes, st.edges), odalar3d: r.rooms, dirty: true }
    })
  },
  addNode3d: (type, x, z, init) => {
    const s = get()
    // Şemada üst üste binmemesi için mevcut ekipmanın altına dizilir.
    const maxY = s.nodes.reduce((m, n) => Math.max(m, n.position.y), -200)
    const id = get().addNode(type, (s.nodes.length % 8) * 240, maxY + 200, init)
    const room = s.odalar3d.find((o) => x >= o.x && x <= o.x + o.g && z >= o.z && z <= o.z + o.d)
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, yerlesim3d: { x, z, ...(room ? { oda: room.id } : {}) } } } : n)),
    }))
    return id
  },
  addOda3d: (oda) => {
    const id = newId('oda')
    set((s) => ({ odalar3d: [...s.odalar3d, { ...oda, id }], dirty: true }))
    return id
  },
  updateOda3d: (id, patch) => set((s) => ({ odalar3d: s.odalar3d.map((o) => (o.id === id ? { ...o, ...patch } : o)), dirty: true })),
  removeOda3d: (id) =>
    set((s) => ({
      odalar3d: s.odalar3d.filter((o) => o.id !== id),
      nodes: s.nodes.map((n) => (n.data.yerlesim3d?.oda === id ? { ...n, data: { ...n.data, yerlesim3d: { ...n.data.yerlesim3d, oda: undefined } } } : n)),
      dirty: true,
    })),
  saveGorunum3d: (g) => set((s) => ({ gorunumler3d: [...s.gorunumler3d.filter((x) => x.ad !== g.ad), g], dirty: true })),
  removeGorunum3d: (index) => set((s) => ({ gorunumler3d: s.gorunumler3d.filter((_, i) => i !== index), dirty: true })),
  setEdgeRoute3d: (edgeId, pts) =>
    set((s) => {
      const edges = s.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), guzergah3d: pts && pts.length ? pts : undefined } } : e))
      return { edges: withLengths(s.nodes, edges), dirty: true }
    }),
  setLengthSource3d: (edgeIds, source) =>
    set((s) => {
      const ids = new Set(edgeIds)
      const edges = s.edges.map((e) => (ids.has(e.id) ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), uzunlukKaynak: source } } : e))
      return { edges: withLengths(s.nodes, edges), dirty: true }
    }),
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
    // Her porta tek hat bağlanır; port ekipmanda tanımlı olmalı.
    const outPort = portOf(c.sourceHandle)
    const inPort = portOf(c.targetHandle)
    if (outPort >= portCount(src.data.kind, src.data.params, 'out')) return false
    if (inPort >= portCount(dst.data.kind, dst.data.params, 'in')) return false
    return !edges.some(
      (e) =>
        (e.source === source && portOf(e.sourceHandle) === outPort) ||
        (e.target === target && portOf(e.targetHandle) === inPort),
    )
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

  addNode: (type, x, y, init) => {
    const def = EQUIPMENT[type]
    const id = newId('d')
    const count = get().nodes.filter((n) => n.data.kind === type).length + 1
    const node: EquipmentNode = {
      id,
      type: 'equipment',
      position: { x, y },
      data: {
        kind: type,
        ad: init?.ad ?? `${def.label.split(" (")[0]} ${count}`, // parantez içi açıklama varsayılan ada alınmaz (Chiller 1, CRAH 2)
        etiket: '',
        grup: '',
        notlar: '',
        params: { ...def.defaults, ...init?.params },
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

  importEquipment: (nodes, edges) =>
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...fromProjectNodes(nodes).map((n) => ({ ...n, selected: true }))],
      edges: [...s.edges.map((e) => ({ ...e, selected: false })), ...fromProjectEdges(edges)],
      dirty: true,
    })),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      dirty: true,
    })),

  updateNodeParam: (id, key, value) =>
    set((s) => {
      let v = value
      if ((key === 'girisSayisi' || key === 'cikisSayisi') && typeof v === 'number') {
        // Bağlı bir port silinmesin: sayı, kullanılan en yüksek port + 1'in altına inemez.
        const inbound = key === 'girisSayisi'
        const used = s.edges
          .filter((e) => (inbound ? e.target : e.source) === id)
          .reduce((m, e) => Math.max(m, portOf(inbound ? e.targetHandle : e.sourceHandle) + 1), 1)
        v = Math.min(MAX_PORTS, Math.max(used, Math.round(v)))
      }
      return {
        nodes: s.nodes.map((n) => {
          if (n.id !== id) return n
          const next = { ...n, data: { ...n.data, params: { ...n.data.params, [key]: v } } }
          // Şema genişliği React Flow düğüm genişliğiyle eşit tutulur (0 = otomatik).
          if (key === 'genislik') {
            if (typeof v === 'number' && v > 0) next.width = v
            else delete next.width
          }
          return next
        }),
        dirty: true,
      }
    }),

  setEdgePort: (edgeId, side, port) => {
    const { edges, nodes } = get()
    const e = edges.find((x) => x.id === edgeId)
    if (!e) return false
    const node = nodes.find((n) => n.id === (side === 'source' ? e.source : e.target))
    if (!node) return false
    const dir = side === 'source' ? 'out' : 'in'
    if (port < 0 || port >= portCount(node.data.kind, node.data.params, dir)) return false
    const handle = handleId(dir, port)
    const taken = edges.some(
      (x) => x.id !== edgeId && (side === 'source' ? x.source === e.source && x.sourceHandle === handle : x.target === e.target && x.targetHandle === handle),
    )
    if (taken) return false
    set((s) => ({
      edges: s.edges.map((x) =>
        x.id === edgeId ? (side === 'source' ? { ...x, sourceHandle: handle } : { ...x, targetHandle: handle }) : x,
      ),
      dirty: true,
    }))
    return true
  },

  /** ATS/STS gibi çok girişli ekipmanda tercih edilen girişi seçer: ona %100, diğerlerine %0 pay. */
  setPreferredInput: (nodeId, edgeId) =>
    set((s) => ({
      edges: s.edges.map((e) =>
        e.target === nodeId ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), pay: e.id === edgeId ? 100 : 0 } } : e,
      ),
      dirty: true,
    })),

  applyCableSpec: (edgeId, spec) =>
    set((s) => ({
      edges: s.edges.map((e) => {
        if (e.id !== edgeId) return e
        const d = e.data ?? DEFAULT_LINE
        const tag = `${spec.n}×${spec.s} mm² Cu/XLPE`
        return {
          ...e,
          data: { ...d, r: Math.round(spec.r * 1e4) / 1e4, x: Math.round(spec.x * 1e4) / 1e4, akimKapasitesi: Math.floor(spec.capacityA), aciklama: d.aciklama.includes('mm² Cu/XLPE') ? d.aciklama : [d.aciklama, tag].filter(Boolean).join(' · ') },
        }
      }),
      dirty: true,
    })),

  updateEdgeData: (id, patch) =>
    set((s) => ({
      edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), ...patch } } : e)),
      dirty: true,
    })),

  setGroupForSelected: (name) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, data: { ...n.data, grup: name.trim() } } : n)),
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
    const sc: Scenario = { id, ad: init?.ad ?? `Senaryo ${n}`, failedNodes: init?.failedNodes ?? [], edgeStates: init?.edgeStates ?? {}, nodeStates: init?.nodeStates ?? {} }
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

  setNodeSwitch: (nodeId, state) => {
    const { activeScenarioId, scenarios, nodes } = get()
    const sc = scenarios.find((x) => x.id === activeScenarioId)
    if (!sc) {
      get().updateNodeParam(nodeId, 'durum', state)
      return
    }
    const baseRaw = nodes.find((n) => n.id === nodeId)?.data.params.durum
    const base = baseRaw === 'acik' ? 'acik' : 'kapali'
    const next = { ...sc.nodeStates }
    if (state === base) delete next[nodeId]
    else next[nodeId] = state
    get().updateScenario(sc.id, { nodeStates: next })
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
      ayarlar: s.ayarlar,
      ...(s.odalar3d.length ? { odalar3d: s.odalar3d } : {}),
      ...(s.gorunumler3d.length ? { gorunumler3d: s.gorunumler3d } : {}),
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
      ayarlar: cloneSettings(p.ayarlar),
      odalar3d: p.odalar3d ? p.odalar3d.map((o) => ({ ...o })) : [],
      gorunumler3d: p.gorunumler3d ? p.gorunumler3d.map((g) => ({ ...g })) : [],
      activeScenarioId: null,
      sim: null,
      simPicked: [],
      dirty: false,
    })),

  newProject: () => get().loadProject(emptyProject()),

  saveToDb: async () => {
    await saveProjectToDb(get().getProject())
    set({ dirty: false })
  },
}))

attachHistory(useStore)
