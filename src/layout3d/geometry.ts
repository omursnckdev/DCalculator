import { isMinor } from './dims'
import type { Dims } from './dims'
import type { EquipmentType, Oda3D } from '../model/types'

/** Zemin düzleminde döndürülmüş dikdörtgen (merkez, boyut, açı). */
export interface Box {
  id: string
  type: EquipmentType
  x: number
  z: number
  g: number
  d: number
  rot: number
  elev: number
  h: number
}

export const snap = (v: number, step: number): number => (step > 0 ? Math.round((Math.round(v / step) * step) * 1e6) / 1e6 : v)

const rad = (deg: number) => (deg * Math.PI) / 180

/** Köşeler (x,z), saat yönünde. */
export function corners(b: Pick<Box, 'x' | 'z' | 'g' | 'd' | 'rot'>): [number, number][] {
  const c = Math.cos(rad(b.rot))
  const s = Math.sin(rad(b.rot))
  const hx = b.g / 2
  const hz = b.d / 2
  return (
    [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ] as [number, number][]
  ).map(([px, pz]) => [b.x + px * c + pz * s, b.z - px * s + pz * c])
}

/** Eksen hizalı sınır kutusu. */
export function bounds(b: Pick<Box, 'x' | 'z' | 'g' | 'd' | 'rot'>): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cs = corners(b)
  const xs = cs.map((p) => p[0])
  const zs = cs.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function project(cs: [number, number][], ax: number, az: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const [x, z] of cs) {
    const v = x * ax + z * az
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

/** Ayırıcı eksen teoremi: iki döndürülmüş dikdörtgen kesişiyor mu (yalnız temas sayılmaz). */
export function rectsOverlap(a: Box, b: Box, eps = 1e-6): boolean {
  const ca = corners(a)
  const cb = corners(b)
  for (const cs of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const [x1, z1] = cs[i]
      const [x2, z2] = cs[i + 1]
      const ax = -(z2 - z1)
      const az = x2 - x1
      const len = Math.hypot(ax, az) || 1
      const [alo, ahi] = project(ca, ax / len, az / len)
      const [blo, bhi] = project(cb, ax / len, az / len)
      if (ahi <= blo + eps || bhi <= alo + eps) return false
    }
  }
  return true
}

/** Dikeyde de örtüşüyor mu (yerden yükseklik). */
const verticalOverlap = (a: Box, b: Box): boolean => a.elev < b.elev + b.h - 1e-6 && b.elev < a.elev + a.h - 1e-6

/** Çakışan ekipman kimlikleri (kesici/ölçü gibi küçük elemanlar ve zemini paylaşan olmayanlar hariç). */
export function findOverlaps(boxes: Box[]): Set<string> {
  const out = new Set<string>()
  const list = boxes.filter((b) => !isMinor(b.type))
  for (let i = 0; i < list.length; i++) {
    const bi = bounds(list[i])
    for (let j = i + 1; j < list.length; j++) {
      const bj = bounds(list[j])
      if (bi.maxX <= bj.minX || bj.maxX <= bi.minX || bi.maxZ <= bj.minZ || bj.maxZ <= bi.minZ) continue
      if (verticalOverlap(list[i], list[j]) && rectsOverlap(list[i], list[j])) {
        out.add(list[i].id)
        out.add(list[j].id)
      }
    }
  }
  return out
}

export const boxOf = (id: string, type: EquipmentType, l: { x: number; z: number; rot?: number; elev?: number }, dims: Dims): Box => ({
  id,
  type,
  x: l.x,
  z: l.z,
  g: dims.g,
  d: dims.d,
  rot: l.rot ?? 0,
  elev: l.elev ?? 0,
  h: dims.y,
})

/** Sürüklemede hizalama: sınır kutusu kenarları/merkezleri diğer ekipman ve oda duvarlarına tol (m) içinde yakınsa yapışır. */
export interface Guide {
  axis: 'x' | 'z'
  at: number
}

export function alignGuides(moving: Box, others: Box[], rooms: Oda3D[], tol = 0.15): { dx: number; dz: number; guides: Guide[] } {
  const mb = bounds(moving)
  const mxs = [mb.minX, (mb.minX + mb.maxX) / 2, mb.maxX]
  const mzs = [mb.minZ, (mb.minZ + mb.maxZ) / 2, mb.maxZ]
  const txs: number[] = []
  const tzs: number[] = []
  for (const o of others) {
    if (o.id === moving.id || isMinor(o.type)) continue
    const b = bounds(o)
    txs.push(b.minX, (b.minX + b.maxX) / 2, b.maxX)
    tzs.push(b.minZ, (b.minZ + b.maxZ) / 2, b.maxZ)
  }
  for (const r of rooms) {
    txs.push(r.x, r.x + r.g)
    tzs.push(r.z, r.z + r.d)
  }
  const best = (ms: number[], ts: number[]): { d: number; at: number } | undefined => {
    let found: { d: number; at: number } | undefined
    for (const m of ms) for (const t of ts) if (Math.abs(t - m) <= tol && (!found || Math.abs(t - m) < Math.abs(found.d))) found = { d: t - m, at: t }
    return found
  }
  const bx = best(mxs, txs)
  const bz = best(mzs, tzs)
  const guides: Guide[] = []
  if (bx) guides.push({ axis: 'x', at: bx.at })
  if (bz) guides.push({ axis: 'z', at: bz.at })
  return { dx: bx?.d ?? 0, dz: bz?.d ?? 0, guides }
}

/** Noktayı içeren oda (ilk eşleşen). */
export function roomAt(rooms: Oda3D[], x: number, z: number): Oda3D | undefined {
  return rooms.find((r) => x >= r.x && x <= r.x + r.g && z >= r.z && z <= r.z + r.d)
}

/** (px, pz) noktasını (cx, cz) etrafında `deg` derece döndürür (corners() ile aynı dönüş yönü: ekipman rot'u artınca takipçiler de aynı yönde döner). */
export function rotateAbout(px: number, pz: number, cx: number, cz: number, deg: number): { x: number; z: number } {
  const a = rad(deg)
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = px - cx
  const dz = pz - cz
  return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c }
}
