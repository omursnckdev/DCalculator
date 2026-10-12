import { create } from 'zustand'

/** Arayüz düzeni tercihleri (kişisel; projeye yazılmaz): sol palet ve sağ özellikler panelinin açık/kapalı durumu. */
const KEY = 'dcalculator:uiPrefs'

interface Prefs {
  leftOpen: boolean
  rightOpen: boolean
  /** Alttaki simülasyon şeridinin gövde yüksekliği, px (sürükleyerek ayarlanır). */
  simHeight: number
}

export const SIM_H_MIN = 90
export const SIM_H_DEFAULT = 230

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    const h = typeof raw.simHeight === 'number' && Number.isFinite(raw.simHeight) ? raw.simHeight : SIM_H_DEFAULT
    return { leftOpen: raw.leftOpen !== false, rightOpen: raw.rightOpen !== false, simHeight: Math.max(SIM_H_MIN, Math.min(1200, h)) }
  } catch {
    return { leftOpen: true, rightOpen: true, simHeight: SIM_H_DEFAULT }
  }
}

interface UiPrefs extends Prefs {
  setLeft: (v: boolean) => void
  setRight: (v: boolean) => void
  setSimHeight: (h: number) => void
  /** Başka bileşenlerin (ör. simülasyon şeridi) ana sekmeyi değiştirme isteği. */
  viewReq: { view: string; seq: number } | null
  requestView: (view: string) => void
}

export const useUiPrefs = create<UiPrefs>((set, get) => {
  const save = () => {
    try {
      const { leftOpen, rightOpen, simHeight } = get()
      localStorage.setItem(KEY, JSON.stringify({ leftOpen, rightOpen, simHeight }))
    } catch {
      /* depolama kapalı */
    }
  }
  return {
    ...load(),
    setLeft: (leftOpen) => {
      set({ leftOpen })
      save()
    },
    setRight: (rightOpen) => {
      set({ rightOpen })
      save()
    },
    setSimHeight: (h) => {
      set({ simHeight: Math.max(SIM_H_MIN, Math.min(1200, Math.round(h))) })
      save()
    },
    viewReq: null,
    requestView: (view) => set((s) => ({ viewReq: { view, seq: (s.viewReq?.seq ?? 0) + 1 } })),
  }
})
