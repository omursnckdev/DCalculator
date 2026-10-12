import { bounds } from './geometry'
import type { Box } from './geometry'

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerZ'

type Patch = Record<string, { x: number; z: number }>

/**
 * Seçili ekipmanı hizalar (sınır kutusu kenarlarına göre): left/right x'te en küçük/en büyük kenara, top/bottom z'de,
 * centerX/centerZ ortak merkeze. En az 2 ekipman gerekir.
 */
export function alignPatches(boxes: Box[], mode: AlignMode): Patch {
  if (boxes.length < 2) return {}
  const bs = boxes.map((b) => ({ b, r: bounds(b) }))
  const minX = Math.min(...bs.map((e) => e.r.minX))
  const maxX = Math.max(...bs.map((e) => e.r.maxX))
  const minZ = Math.min(...bs.map((e) => e.r.minZ))
  const maxZ = Math.max(...bs.map((e) => e.r.maxZ))
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const out: Patch = {}
  for (const { b, r } of bs) {
    let x = b.x
    let z = b.z
    if (mode === 'left') x = b.x + (minX - r.minX)
    else if (mode === 'right') x = b.x + (maxX - r.maxX)
    else if (mode === 'top') z = b.z + (minZ - r.minZ)
    else if (mode === 'bottom') z = b.z + (maxZ - r.maxZ)
    else if (mode === 'centerX') x = b.x + (cx - (r.minX + r.maxX) / 2)
    else z = b.z + (cz - (r.minZ + r.maxZ) / 2)
    out[b.id] = { x: Math.round(x * 1e4) / 1e4, z: Math.round(z * 1e4) / 1e4 }
  }
  return out
}

/** Eşit aralık: ilk ve son ekipman yerinde kalır, aradakiler sınır kutuları arasındaki boşluk eşit olacak biçimde dağıtılır. En az 3 ekipman. */
export function distributePatches(boxes: Box[], axis: 'x' | 'z'): Patch {
  if (boxes.length < 3) return {}
  const items = boxes
    .map((b) => {
      const r = bounds(b)
      return { b, lo: axis === 'x' ? r.minX : r.minZ, hi: axis === 'x' ? r.maxX : r.maxZ }
    })
    .sort((a, c) => a.lo + a.hi - (c.lo + c.hi))
  const first = items[0]
  const last = items[items.length - 1]
  const totalSize = items.reduce((s, e) => s + (e.hi - e.lo), 0)
  const gap = (last.hi - first.lo - totalSize) / (items.length - 1)
  const out: Patch = {}
  let cursor = first.lo
  for (const e of items) {
    const shift = cursor - e.lo
    out[e.b.id] = axis === 'x' ? { x: Math.round((e.b.x + shift) * 1e4) / 1e4, z: e.b.z } : { x: e.b.x, z: Math.round((e.b.z + shift) * 1e4) / 1e4 }
    cursor += e.hi - e.lo + gap
  }
  return out
}
