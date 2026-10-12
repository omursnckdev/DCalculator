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
  Boru3D,
  Gorunum3D,
  Nokta3D,
  Oda3D,
  Plan3D,
  Tava3D,
  Yerlesim3D,
} from '../model/types'
import { DEFAULT_SETTINGS, cloneSettings } from '../model/settings'
import type { ProjectSettings } from '../model/settings'
import { simulateAdditionalFault, simulateFailure, simulateRecovery } from '../engine'
import type { SimStep } from '../engine'
import { autoLayout, mountPatches } from '../layout3d/autoLayout'
import { isMinor } from '../layout3d/dims'
import { lengthPatches } from '../layout3d/lengths'
import { autoPipes, dnFor, flowLps } from '../layout3d/pipes'
import { TrayNet } from '../layout3d/trays'
import { anchorOf as bboxAnchor } from '../layout3d/route'
import { boxOf, roomAt } from '../layout3d/geometry'
import { applyPlan } from '../layout3d/plan'
import { canClonePl1, clonePl1ToPl2 } from '../model/clonePlan'
import { planHatCizelgesi } from '../model/hatCizelgesi'
import type { HatCizelgesi, HatRapor } from '../model/hatCizelgesi'
import { dimsOf } from '../layout3d/dims'
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
  /** Kat planı (PDF/DXF'ten): duvarlar, odalar, ekipman dikdörtgenleri. */
  plan3d: Plan3D | null
  /** Planı uygular: etiket eşleşen ekipman plana oturur, odalar/duvarlar yazılır. Eşleşen/eşleşmeyen sayısı döner. */
  importPlan3d: (plan: Plan3D, opts?: { ekle?: boolean; kopyaPl2?: boolean }) => { matched: number; unmatched: number; unused: string[]; eklenen: number; klonlanan: number }
  /** Hat çizelgesindeki kablo/bara/şalter bağlantılarını ekler (eşleşmeyen ekipman oluşturulur); tekrar uygulamak değişiklik üretmez. */
  applyHatCizelgesi: (spec: HatCizelgesi) => HatRapor
  removePlan3d: () => void
  gorunumler3d: Gorunum3D[]
  /** Kablo tavaları ve boru hatları (geri alınabilir). */
  tavalar3d: Tava3D[]
  borular3d: Boru3D[]
  addTava3d: (t: Omit<Tava3D, 'id'>) => string
  updateTava3d: (id: string, patch: Partial<Omit<Tava3D, 'id'>>) => void
  removeTava3d: (id: string) => void
  addBoru3d: (b: Omit<Boru3D, 'id'>) => string
  updateBoru3d: (id: string, patch: Partial<Omit<Boru3D, 'id'>>) => void
  removeBoru3d: (id: string) => void
  /** Kabloları (tip: kablo) tava ağı üzerinden yönlendirir (`guzergah3d`); yönlendirilemeyenler değişmez. */
  routeCablesViaTrays3d: () => { routed: number; total: number }
  /** Tüm kabloların 3D güzergâhını varsayılana (otomatik ortogonal) döndürür. */
  resetCableRoutes3d: () => void
  /** Otomatik boruları (soğuk su, kondenser) yerleşimden yeniden üretir; elle çizilenler korunur. Üretilen boru sayısını döndürür. */
  autoPipes3d: () => number
  /** Ekipmanların 3D yerleşimini günceller (yerleşimi olmayan düğüm için x,z gerekir). */
  setLayout3d: (patches: Record<string, Partial<Yerlesim3D>>) => void
  /** Yerleşimi olmayan ekipmanı yerleştirir; hiçbiri yerleşik değilse tümünü diziler ve odaları üretir. */
  ensureLayout3d: () => void
  /** Tüm küçük elemanları (kesici, ölçü) ana ekipmanlarının ön yüzüne oturtur. */
  mountMinors3d: () => void
  /** Tüm ekipmanı yeniden dizer ve odaları yeniden üretir. */
  autoLayout3d: () => void
  /** 3D sahnede ekipman ekler (x,z metre); şemada ayrıca otomatik bir konum alır. */
  addNode3d: (type: EquipmentType, x: number, z: number, init?: { ad?: string; params?: Params }) => string
  /** Seçili ekipmanı (3D yerleşimi olanları) 1 m kaydırarak kopyalar; yeni kopyalar seçili olur. Hatlar kopyalanmaz. */
  duplicateSelected3d: () => string[]
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
  plan3d: null,
  importPlan3d: (plan, opts = {}) => {
    const s = get()
    let model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    // PL1 zinciri PL2'ye kopyalanır (şemada yan yana, sağda)
    let klonlanan = 0
    let clone: ReturnType<typeof clonePl1ToPl2> | null = null
    if (opts.kopyaPl2 && canClonePl1(model)) {
      const xs = model.nodes.map((n) => n.x)
      clone = clonePl1ToPl2(model, Math.max(...xs) - Math.min(...xs) + 400)
      model = { nodes: [...model.nodes, ...clone.nodes], edges: [...model.edges, ...clone.edges] }
      klonlanan = clone.nodes.length
    }
    const r = applyPlan(model, plan, { ekle: opts.ekle })
    // Plandaki, şemada olmayan nesneler: yeni düğümler (şemanın altında ızgara)
    const baseX = Math.min(0, ...model.nodes.map((n) => n.x))
    const baseY = Math.max(0, ...model.nodes.map((n) => n.y)) + 300
    const eklenen: ProjectNode[] = r.yeni.map((y, i) => ({
      id: newId('p'),
      type: y.tur,
      ad: y.ad,
      etiket: '',
      grup: 'Plan',
      notlar: y.aile ? `DXF: ${y.aile}` : '',
      x: baseX + (i % 12) * 220,
      y: baseY + Math.floor(i / 12) * 140,
      params: y.params,
      yerlesim3d: y.yerlesim,
    }))
    set((st) => {
      const cNodes = clone ? fromProjectNodes(clone.nodes) : []
      const cEdges = clone ? fromProjectEdges(clone.edges) : []
      const all = [...st.nodes, ...cNodes, ...fromProjectNodes(eklenen)]
      const nodes = all.map((n) => (r.placements[n.id] ? { ...n, data: { ...n.data, yerlesim3d: r.placements[n.id] } } : n))
      const edges = [...st.edges, ...cEdges]
      return { nodes, edges: withLengths(nodes, edges), odalar3d: r.rooms, plan3d: plan, dirty: true }
    })
    return { matched: r.matched, unmatched: r.unmatched, unused: r.unused, eklenen: eklenen.length, klonlanan }
  },
  applyHatCizelgesi: (spec) => {
    const s = get()
    const model = { nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) }
    const d = planHatCizelgesi(model, spec, newId)
    const degisti = d.addNodes.length + d.addEdges.length + d.removeNodeIds.length + d.removeEdgeIds.length + Object.keys(d.paramPatches).length
    if (degisti === 0) return d.rapor
    set((st) => {
      const rn = new Set(d.removeNodeIds)
      const re = new Set(d.removeEdgeIds)
      const kept = st.nodes
        .filter((n) => !rn.has(n.id))
        .map((n) => {
          const p = d.paramPatches[n.id]
          const pos = d.posPatches[n.id]
          if (!p && !pos) return n
          return { ...n, ...(pos ? { position: { x: pos.x, y: pos.y } } : {}), data: p ? { ...n.data, params: { ...n.data.params, ...p } } : n.data }
        })
      const nodes = [...kept, ...fromProjectNodes(d.addNodes.map((n) => ({ ...n, ...(d.posPatches[n.id] ?? {}) })))]
      const edges = [...st.edges.filter((e) => !re.has(e.id)), ...fromProjectEdges(d.addEdges)]
      return { nodes, edges: withLengths(nodes, edges), dirty: true }
    })
    // 3B: yeni ekipman ve şalterler yerleşsin (plan varsa plana göre, yoksa otomatik).
    const cur = get()
    if (cur.plan3d) cur.importPlan3d(cur.plan3d)
    else cur.ensureLayout3d()
    return d.rapor
  },
  removePlan3d: () => set({ plan3d: null, dirty: true }),
  gorunumler3d: [],
  tavalar3d: [],
  borular3d: [],
  addTava3d: (t) => {
    const id = newId('tava')
    set((s) => ({ tavalar3d: [...s.tavalar3d, { ...t, id }], dirty: true }))
    return id
  },
  updateTava3d: (id, patch) => set((s) => ({ tavalar3d: s.tavalar3d.map((t) => (t.id === id ? { ...t, ...patch } : t)), dirty: true })),
  removeTava3d: (id) => set((s) => ({ tavalar3d: s.tavalar3d.filter((t) => t.id !== id), dirty: true })),
  addBoru3d: (b) => {
    const id = newId('boru')
    set((s) => ({ borular3d: [...s.borular3d, { ...b, id }], dirty: true }))
    return id
  },
  updateBoru3d: (id, patch) =>
    set((s) => ({
      borular3d: s.borular3d.map((b) => {
        if (b.id !== id) return b
        const next = { ...b, ...patch }
        // DN elle verilmediyse yüke göre yeniden seçilir.
        if (!next.dnElle && (patch.kw !== undefined || patch.noktalar !== undefined)) next.dn = dnFor(flowLps(next.kw))
        return next
      }),
      dirty: true,
    })),
  removeBoru3d: (id) => set((s) => ({ borular3d: s.borular3d.filter((b) => b.id !== id), dirty: true })),
  routeCablesViaTrays3d: () => {
    const s = get()
    const pn = toProjectNodes(s.nodes)
    const byId = new Map(pn.map((n) => [n.id, n]))
    const net = new TrayNet(s.tavalar3d)
    const patches = new Map<string, Nokta3D[]>()
    let total = 0
    for (const e of s.edges) {
      if (e.data?.tip !== 'kablo') continue
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      if (!a?.yerlesim3d || !b?.yerlesim3d) continue
      const ba = boxOf(a.id, a.type, a.yerlesim3d, dimsOf(a))
      const bb = boxOf(b.id, b.type, b.yerlesim3d, dimsOf(b))
      // Katlar arası hatlar kat şaftından (varsayılan güzergâh) geçer; tavaya bağlanmaz ve toplama girmez.
      if (Math.abs(ba.elev - bb.elev) > 2) continue
      total++
      const r = net.route(bboxAnchor(ba), bboxAnchor(bb))
      if (r) patches.set(e.id, r.points)
    }
    if (patches.size > 0) {
      const edges = s.edges.map((e) => (patches.has(e.id) ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), guzergah3d: patches.get(e.id) } } : e))
      set({ edges: withLengths(s.nodes, edges), dirty: true })
    }
    return { routed: patches.size, total }
  },
  resetCableRoutes3d: () =>
    set((s) => {
      const edges = s.edges.map((e) => (e.data?.guzergah3d ? { ...e, data: { ...(e.data ?? DEFAULT_LINE), guzergah3d: undefined } } : e))
      return { edges: withLengths(s.nodes, edges), dirty: true }
    }),
  autoPipes3d: () => {
    const s = get()
    let k = 0
    const made = autoPipes(toProjectNodes(s.nodes), () => `${newId('boru')}${k++}`)
    set((st) => ({ borular3d: [...st.borular3d.filter((b) => !b.otomatik), ...made], dirty: true }))
    return made.length
  },
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
    if (missing.length > 0) {
      const all = missing.length === model.nodes.length
      const r = autoLayout(model, all ? 'all' : 'missing', s.odalar3d)
      set((st) => {
        const nodes = st.nodes.map((n) => (r.placements[n.id] && !n.data.yerlesim3d ? { ...n, data: { ...n.data, yerlesim3d: r.placements[n.id] } } : n))
        return { nodes, edges: withLengths(nodes, st.edges), odalar3d: all ? r.rooms : st.odalar3d, dirty: true }
      })
    }
    // Göç: eski yerleşimlerdeki (panonun yanında duran) küçük elemanlar bir kez ana ekipmanın ön yüzüne oturtulur.
    const cur = get()
    const m2 = { nodes: toProjectNodes(cur.nodes), edges: toProjectEdges(cur.edges) }
    const unmounted = new Set(m2.nodes.filter((n) => isMinor(n.type) && n.yerlesim3d && !n.yerlesim3d.mont).map((n) => n.id))
    if (unmounted.size > 0) {
      const patches = mountPatches(m2, unmounted)
      if (Object.keys(patches).length > 0) get().setLayout3d(patches)
    }
  },
  mountMinors3d: () => {
    const s = get()
    const patches = mountPatches({ nodes: toProjectNodes(s.nodes), edges: toProjectEdges(s.edges) })
    if (Object.keys(patches).length > 0) get().setLayout3d(patches)
  },
  autoLayout3d: () => {
    const s = get()
    // Kat planı varsa "otomatik yerleşim" planı yeniden uygular (plana oturan ekipman yerinde kalır).
    if (s.plan3d) {
      get().importPlan3d(s.plan3d)
      return
    }
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
    const room = roomAt(s.odalar3d, x, z, 0)
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, yerlesim3d: { x, z, ...(room ? { oda: room.id } : {}) } } } : n)),
    }))
    return id
  },
  duplicateSelected3d: () => {
    const s = get()
    const src = s.nodes.filter((n) => n.selected && n.data.yerlesim3d)
    if (src.length === 0) return []
    const ids: string[] = []
    const copies: EquipmentNode[] = src.map((n) => {
      const id = newId('d')
      ids.push(id)
      const l = n.data.yerlesim3d!
      return {
        ...n,
        id,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
        data: { ...n.data, ad: `${n.data.ad} (kopya)`, params: { ...n.data.params }, yerlesim3d: { ...l, x: l.x + 1, z: l.z + 1 } },
      }
    })
    set((st) => ({ nodes: [...st.nodes.map((n) => ({ ...n, selected: false })), ...copies], edges: st.edges.map((e) => ({ ...e, selected: false })), dirty: true }))
    return ids
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
      ...(s.plan3d ? { plan3d: s.plan3d } : {}),
      ...(s.gorunumler3d.length ? { gorunumler3d: s.gorunumler3d } : {}),
      ...(s.tavalar3d.length ? { tavalar3d: s.tavalar3d } : {}),
      ...(s.borular3d.length ? { borular3d: s.borular3d } : {}),
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
      plan3d: p.plan3d ?? null,
      gorunumler3d: p.gorunumler3d ? p.gorunumler3d.map((g) => ({ ...g })) : [],
      tavalar3d: p.tavalar3d ? p.tavalar3d.map((t) => ({ ...t, noktalar: t.noktalar.map((q) => ({ ...q })) })) : [],
      borular3d: p.borular3d ? p.borular3d.map((b) => ({ ...b, noktalar: b.noktalar.map((q) => ({ ...q })), uretici: [...b.uretici], pompalar: [...b.pompalar] })) : [],
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
