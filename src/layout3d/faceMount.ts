import type { Yerlesim3D } from '../model/types'

/** Panoya (veya başka bir ana ekipmana) oturacak küçük eleman: boyut (genişlik, derinlik, yükseklik) m. */
export interface MountItem {
  id: string
  g: number
  d: number
  h: number
}

export interface AnchorBox {
  x: number
  z: number
  g: number
  d: number
  h: number
  rot: number
  elev: number
}

const MARGIN = 0.04 // genişliğin her iki yanındaki pay (oran)
const BASE = 0.25 // kaide payı, m
const ROW_GAP = 0.06
const COL_GAP = 0.03

/**
 * Küçük elemanları (kesici, ölçü) ana ekipmanın ön yüzüne dizer: soldan sağa, satır dolunca bir üst satır. Modül ön yüzden
 * kendi derinliği kadar dışarı çıkar. Konumlar ana ekipmanın dönüşüne uyar (aynı rot). Sonuç `yerlesim3d` biçimindedir (mont: true).
 */
export function mountOnFace(anchor: AnchorBox, items: MountItem[]): Record<string, Yerlesim3D> {
  const out: Record<string, Yerlesim3D> = {}
  const usable = Math.max(0.3, anchor.g * (1 - 2 * MARGIN))
  const a = (anchor.rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  let cursor = 0
  let rowBottom = BASE
  let rowH = 0
  for (const it of items) {
    if (cursor > 0 && cursor + it.g > usable) {
      rowBottom += rowH + ROW_GAP
      cursor = 0
      rowH = 0
    }
    const lx = -usable / 2 + cursor + it.g / 2
    const lz = anchor.d / 2 + it.d / 2
    out[it.id] = {
      // corners() dönüş kuralı: dünya = merkez + (lx·cos + lz·sin, −lx·sin + lz·cos)
      x: Math.round((anchor.x + lx * c + lz * s) * 1e4) / 1e4,
      z: Math.round((anchor.z - lx * s + lz * c) * 1e4) / 1e4,
      elev: Math.round((anchor.elev + rowBottom) * 1e4) / 1e4,
      rot: anchor.rot,
      mont: true,
    }
    cursor += it.g + COL_GAP
    rowH = Math.max(rowH, it.h)
  }
  return out
}
