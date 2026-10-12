import { create } from 'zustand'

/** Arayüz düzeni tercihleri (kişisel; projeye yazılmaz): sol palet ve sağ özellikler panelinin açık/kapalı durumu. */
const KEY = 'dcalculator:uiPrefs'

interface Prefs {
  leftOpen: boolean
  rightOpen: boolean
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return { leftOpen: raw.leftOpen !== false, rightOpen: raw.rightOpen !== false }
  } catch {
    return { leftOpen: true, rightOpen: true }
  }
}

interface UiPrefs extends Prefs {
  setLeft: (v: boolean) => void
  setRight: (v: boolean) => void
}

export const useUiPrefs = create<UiPrefs>((set, get) => {
  const save = () => {
    try {
      const { leftOpen, rightOpen } = get()
      localStorage.setItem(KEY, JSON.stringify({ leftOpen, rightOpen }))
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
  }
})
