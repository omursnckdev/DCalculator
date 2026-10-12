import type { StoreApi, UseBoundStore } from 'zustand'
import { cloneSettings } from '../model/settings'
import type { ProjectSettings } from '../model/settings'
import { fromProjectEdges, fromProjectNodes, toProjectEdges, toProjectNodes } from '../model/project'
import type { Oda3D, ProjectEdge, ProjectNode, Scenario } from '../model/types'

/**
 * Geri al / yinele: şema içeriği (ekipman, hat, senaryo, ayarlar, ad) değiştikçe anlık görüntü alınır.
 * Kısa aralıklı ardışık değişiklikler (sürükleme, yazma) tek adım sayılır. Seçim ve görünüm geçmişe girmez.
 */
interface Snap {
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  scenarios: Scenario[]
  ayarlar: ProjectSettings
  odalar3d: Oda3D[]
  name: string
}

/** Aynı adımda birleşen değişiklikler arasındaki en uzun boşluk, ms. */
const BURST_MS = 600
const LIMIT = 100

/** Geçmişin ihtiyaç duyduğu minimum durum arayüzü. */
interface HistoryState {
  projectId: string
  projectName: string
  nodes: Parameters<typeof toProjectNodes>[0]
  edges: Parameters<typeof toProjectEdges>[0]
  scenarios: Scenario[]
  ayarlar: ProjectSettings
  odalar3d: Oda3D[]
  history: { undo: number; redo: number }
}

let undoStack: Snap[] = []
let redoStack: Snap[] = []
let lastSnap: Snap | null = null
let lastKey = ''
let lastChangeAt = 0
let restoring = false
let api: UseBoundStore<StoreApi<HistoryState>> | null = null

const snapOf = (s: HistoryState): Snap => ({
  nodes: toProjectNodes(s.nodes),
  edges: toProjectEdges(s.edges),
  scenarios: s.scenarios,
  ayarlar: s.ayarlar,
  odalar3d: s.odalar3d,
  name: s.projectName,
})

/** Referansı değişmeyen büyük nesneler (ayarlar, senaryolar, odalar) bir kez dizgeleştirilir. */
const jsonMemo = new WeakMap<object, string>()
const js = (o: object): string => {
  let v = jsonMemo.get(o)
  if (v === undefined) {
    v = JSON.stringify(o)
    jsonMemo.set(o, v)
  }
  return v
}
const keyOf = (sn: Snap): string => `${JSON.stringify(sn.nodes)}|${JSON.stringify(sn.edges)}|${js(sn.scenarios)}|${js(sn.ayarlar)}|${js(sn.odalar3d)}|${sn.name}`

function publish(): void {
  api?.setState({ history: { undo: undoStack.length, redo: redoStack.length } })
}

/** Geçmişi sıfırla (yeni/yüklenen proje) ve mevcut durumu başlangıç kabul et. */
function reset(s: HistoryState): void {
  undoStack = []
  redoStack = []
  lastSnap = snapOf(s)
  lastKey = keyOf(lastSnap)
  lastChangeAt = 0
  publish()
}

export function attachHistory<S extends HistoryState>(store: UseBoundStore<StoreApi<S>>): void {
  api = store as unknown as UseBoundStore<StoreApi<HistoryState>>
  reset(store.getState())
  store.subscribe((s, prev) => {
    if (restoring) return
    if (s.projectId !== prev.projectId) {
      reset(s)
      return
    }
    if (s.nodes === prev.nodes && s.edges === prev.edges && s.scenarios === prev.scenarios && s.ayarlar === prev.ayarlar && s.odalar3d === prev.odalar3d && s.projectName === prev.projectName) return
    const cur = snapOf(s)
    const key = keyOf(cur)
    if (key === lastKey) return // yalnız seçim/boyut gibi içerik dışı değişiklik
    const now = Date.now()
    if (lastSnap && now - lastChangeAt >= BURST_MS) {
      undoStack.push(lastSnap)
      if (undoStack.length > LIMIT) undoStack.shift()
      redoStack = []
      publish()
    }
    lastSnap = cur
    lastKey = key
    lastChangeAt = now
  })
}

function apply(sn: Snap): void {
  if (!api) return
  restoring = true
  try {
    api.setState({
      nodes: fromProjectNodes(sn.nodes),
      edges: fromProjectEdges(sn.edges),
      scenarios: sn.scenarios,
      ayarlar: cloneSettings(sn.ayarlar),
      odalar3d: sn.odalar3d.map((o) => ({ ...o })),
      projectName: sn.name,
      dirty: true,
    } as Partial<HistoryState>)
  } finally {
    restoring = false
  }
  lastSnap = sn
  lastKey = keyOf(sn)
  lastChangeAt = 0
}

export function undo(): void {
  if (!api || undoStack.length === 0) return
  const cur = snapOf(api.getState())
  const target = undoStack.pop()!
  redoStack.push(cur)
  apply(target)
  publish()
}

export function redo(): void {
  if (!api || redoStack.length === 0) return
  const cur = snapOf(api.getState())
  const target = redoStack.pop()!
  undoStack.push(cur)
  apply(target)
  publish()
}
