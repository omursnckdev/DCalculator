import type { Oda3D } from '../model/types'
import { isMinor } from './dims'
import { surfaceHeight } from './floors'
import type { Merdiven } from './floors'
import type { Box } from './geometry'

/** Yürüme modu: göz yüksekliği ve gövde yarıçapı (m). */
export const EYE_HEIGHT = 1.7
export const BODY_RADIUS = 0.35

/** Vücut yüksekliği (m): ayak kotundan bu kadar yukarıdaki ekipman engel değildir; 0,3 m'den alçak basamak/engel aşılır. */
const BODY_HEIGHT = 1.8
const STEP_OVER = 0.3

/**
 * Yürüyüşü engelleyen ekipman: küçük elemanlar (kesici/ölçü) ve 0,5 m'den alçak (üzerinden geçilir) olanlar engel değildir.
 * `feet` ayak kotudur: yalnız vücutla (feet+0,3 … feet+1,8) dikeyde kesişen ekipman engeldir (başka kattakiler değil).
 */
const obstacles = (boxes: Box[], feet: number): Box[] => boxes.filter((b) => !isMinor(b.type) && b.h >= 0.5 && b.elev < feet + BODY_HEIGHT && b.elev + b.h > feet + STEP_OVER)

/** (x, z) noktası ekipmanın (r kadar genişletilmiş) döndürülmüş dikdörtgeninin içinde mi. */
export function inside(b: Pick<Box, 'x' | 'z' | 'g' | 'd' | 'rot'>, x: number, z: number, r: number): boolean {
  const a = (b.rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = x - b.x
  const dz = z - b.z
  // Yerel koordinat: corners() dönüşünün tersi
  const px = dx * c - dz * s
  const pz = dx * s + dz * c
  return Math.abs(px) < b.g / 2 + r && Math.abs(pz) < b.d / 2 + r
}

export function blockedAt(boxes: Box[], x: number, z: number, r = BODY_RADIUS, feet = 0): boolean {
  return obstacles(boxes, feet).some((b) => inside(b, x, z, r))
}

/**
 * (x, z) konumundan (dx, dz) kadar yürür; engele çarparsa önce tam hareketi, sonra yalnız x'i, sonra yalnız z'yi dener
 * (duvara paralel kayma). Hareket tümüyle engelliyse konum değişmez.
 */
export function walkStep(boxes: Box[], x: number, z: number, dx: number, dz: number, r = BODY_RADIUS, feet = 0): { x: number; z: number } {
  if (!blockedAt(boxes, x + dx, z + dz, r, feet)) return { x: x + dx, z: z + dz }
  if (dx !== 0 && !blockedAt(boxes, x + dx, z, r, feet)) return { x: x + dx, z }
  if (dz !== 0 && !blockedAt(boxes, x, z + dz, r, feet)) return { x, z: z + dz }
  return { x, z }
}

/** Duvar çizgisi [x1, z1, x2, z2] (m). */
export type WallSeg = [number, number, number, number]
/** Duvar çarpışma yarıçapı (m): kapı boşluklarından (≈ 0,9 m) geçilebilsin diye gövdeden küçüktür. */
export const WALL_RADIUS = 0.25
const WALL_HEIGHT = 3.4

/** (x, z) noktası bir duvar çizgisine r'den yakınsa ve ayak kotu duvar yüksekliğinin altındaysa true. */
export function wallBlocked(walls: WallSeg[], x: number, z: number, r = WALL_RADIUS, feet = 0): boolean {
  if (feet >= WALL_HEIGHT) return false
  for (const [x1, z1, x2, z2] of walls) {
    if (x < Math.min(x1, x2) - r || x > Math.max(x1, x2) + r || z < Math.min(z1, z2) - r || z > Math.max(z1, z2) + r) continue
    const dx = x2 - x1
    const dz = z2 - z1
    const l2 = dx * dx + dz * dz
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2))
    const px = x1 + t * dx - x
    const pz = z1 + t * dz - z
    if (px * px + pz * pz < r * r) return true
  }
  return false
}

export interface WalkState {
  x: number
  z: number
  /** Ayak (zemin) kotu, m. */
  h: number
}

/**
 * Katlı yürüme: hareketi dener (tam, yalnız x, yalnız z). Ekipman engeli ayak kotuna göre denetlenir; yeni konumdaki yüzey
 * (zemin / üst kat döşemesi / merdiven) `surfaceHeight` ile bulunur — kenardan düşme ve erişilemeyen kat engeldir.
 */
export function walkStepFloors(boxes: Box[], rooms: Oda3D[], stairs: Merdiven[], st: WalkState, dx: number, dz: number, r = BODY_RADIUS, walls: WallSeg[] = []): WalkState {
  const tries: [number, number][] = [[dx, dz]]
  if (dx !== 0 && dz !== 0) tries.push([dx, 0], [0, dz])
  else if (dx !== 0 || dz !== 0) tries.push(dx !== 0 ? [dx, 0] : [0, dz])
  for (const [tx, tz] of tries) {
    if (tx === 0 && tz === 0) continue
    const nx = st.x + tx
    const nz = st.z + tz
    const h = surfaceHeight(rooms, stairs, nx, nz, st.h)
    if (h === null) continue
    if (blockedAt(boxes, nx, nz, r, h)) continue
    if (walls.length && wallBlocked(walls, nx, nz, WALL_RADIUS, h)) continue
    return { x: nx, z: nz, h }
  }
  return st
}

/** (x, z) engelliyse en yakın boş noktayı (0,5 m adımlı sarmal arama, ≤ 25 m) bulur. */
export function freeSpot(boxes: Box[], x: number, z: number, r = BODY_RADIUS, feet = 0): { x: number; z: number } {
  if (!blockedAt(boxes, x, z, r, feet)) return { x, z }
  for (let ring = 1; ring <= 50; ring++) {
    const d = ring * 0.5
    for (let k = 0; k < 8 * ring; k++) {
      const a = (k / (8 * ring)) * Math.PI * 2
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      if (!blockedAt(boxes, px, pz, r, feet)) return { x: px, z: pz }
    }
  }
  return { x, z }
}

/** Yaw (rad) ve ileri hız bileşenleri: yaw 0 → −z yönüne bakar. */
export const forwardOf = (yaw: number): { x: number; z: number } => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const rightOf = (yaw: number): { x: number; z: number } => ({ x: Math.cos(yaw), z: -Math.sin(yaw) })
