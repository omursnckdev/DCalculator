import { create } from 'zustand'
import type { ColorMode } from '../layout3d/colors'
import type { Guide } from '../layout3d/geometry'

/** 3D görünüm tercihleri ve geçici durum (kişisel; projeye yazılmaz). Tercihler localStorage'da saklanır. */
export type CamMode = 'persp' | 'top'
export type ViewName = 'fit' | 'front' | 'side' | 'top' | 'persp'

export interface CamRequest {
  seq: number
  pos: [number, number, number]
  target: [number, number, number]
  mode: CamMode
}

interface Prefs {
  colorMode: ColorMode
  snapStep: number
  hideWalls: boolean
  showHeat: boolean
  showCables: boolean
  showLabels: boolean
  quality: 'dusuk' | 'normal' | 'yuksek'
}

const KEY = 'dcalculator:view3d'
const DEFAULTS: Prefs = { colorMode: 'tur', snapStep: 0.1, hideWalls: false, showHeat: true, showCables: true, showLabels: false, quality: 'normal' }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      colorMode: (['tur', 'doluluk', 'isi', 'enerji', 'grup'] as const).includes(raw.colorMode as never) ? (raw.colorMode as ColorMode) : DEFAULTS.colorMode,
      snapStep: typeof raw.snapStep === 'number' && raw.snapStep >= 0 && raw.snapStep <= 2 ? raw.snapStep : DEFAULTS.snapStep,
      hideWalls: typeof raw.hideWalls === 'boolean' ? raw.hideWalls : DEFAULTS.hideWalls,
      showHeat: typeof raw.showHeat === 'boolean' ? raw.showHeat : DEFAULTS.showHeat,
      showCables: typeof raw.showCables === 'boolean' ? raw.showCables : DEFAULTS.showCables,
      showLabels: typeof raw.showLabels === 'boolean' ? raw.showLabels : DEFAULTS.showLabels,
      quality: raw.quality === 'dusuk' || raw.quality === 'yuksek' ? raw.quality : 'normal',
    }
  } catch {
    return DEFAULTS
  }
}

interface View3DState extends Prefs {
  setPrefs: (p: Partial<Prefs>) => void
  camMode: CamMode
  camRequest: CamRequest | null
  /** Kamerayı verilen konuma taşır (CameraRig uygular). */
  moveCamera: (pos: [number, number, number], target: [number, number, number], mode?: CamMode) => void
  /** Hazır kamera görünümü isteği (CameraRig uygular): sığdır, ön, yan, üst (kuşbakışı), perspektif. */
  viewReq: { seq: number; name: ViewName } | null
  requestView: (name: ViewName) => void
  /** Seçili ekipmana odaklanma isteği. */
  focusId: { id: string; seq: number } | null
  focus: (id: string) => void
  /** Sürüklerken hizalama kılavuzları. */
  guides: Guide[]
  setGuides: (g: Guide[]) => void
  hoverId: string | null
  setHover: (id: string | null) => void
  /** Yürüme (birinci şahıs) modu. */
  walk: boolean
  setWalk: (on: boolean) => void
  /** Seçim kutusu (ekran koordinatları, px). */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  setMarquee: (m: { x0: number; y0: number; x1: number; y1: number } | null) => void
  measure: boolean
  measurePts: [number, number][]
  setMeasure: (on: boolean) => void
  addMeasurePt: (p: [number, number]) => void
  /** Güncel kamera durumu (kayıtlı görünüm için). */
  camState: { pos: [number, number, number]; target: [number, number, number] } | null
  setCamState: (s: { pos: [number, number, number]; target: [number, number, number] }) => void
}

export const use3dStore = create<View3DState>((set, get) => ({
  ...loadPrefs(),
  setPrefs: (p) => {
    set(p)
    const s = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ colorMode: s.colorMode, snapStep: s.snapStep, hideWalls: s.hideWalls, showHeat: s.showHeat, showCables: s.showCables, showLabels: s.showLabels, quality: s.quality }))
    } catch {
      /* depolama kapalı */
    }
  },
  camMode: 'persp',
  camRequest: null,
  moveCamera: (pos, target, mode) => set((s) => ({ camRequest: { seq: (s.camRequest?.seq ?? 0) + 1, pos, target, mode: mode ?? s.camMode }, camMode: mode ?? s.camMode })),
  viewReq: null,
  requestView: (name) => set((s) => ({ viewReq: { seq: (s.viewReq?.seq ?? 0) + 1, name } })),
  focusId: null,
  focus: (id) => set((s) => ({ focusId: { id, seq: (s.focusId?.seq ?? 0) + 1 } })),
  guides: [],
  setGuides: (guides) => set({ guides }),
  hoverId: null,
  setHover: (hoverId) => set({ hoverId }),
  walk: false,
  setWalk: (walk) => set({ walk, measure: false }),
  marquee: null,
  setMarquee: (marquee) => set({ marquee }),
  measure: false,
  measurePts: [],
  setMeasure: (on) => set({ measure: on, measurePts: [] }),
  addMeasurePt: (p) => set((s) => ({ measurePts: s.measurePts.length >= 2 ? [p] : [...s.measurePts, p] })),
  camState: null,
  setCamState: (camState) => set({ camState }),
}))
