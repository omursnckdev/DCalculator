import { isMinor } from './dims'
import type { Box } from './geometry'

/** Yürüme modu: göz yüksekliği ve gövde yarıçapı (m). */
export const EYE_HEIGHT = 1.7
export const BODY_RADIUS = 0.35

/** Yürüyüşü engelleyen ekipman: küçük elemanlar (kesici/ölçü) ve 0,5 m'den alçak (üzerinden geçilir) olanlar engel değildir. */
const obstacles = (boxes: Box[]): Box[] => boxes.filter((b) => !isMinor(b.type) && b.h >= 0.5 && b.elev < 2)

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

export function blockedAt(boxes: Box[], x: number, z: number, r = BODY_RADIUS): boolean {
  return obstacles(boxes).some((b) => inside(b, x, z, r))
}

/**
 * (x, z) konumundan (dx, dz) kadar yürür; engele çarparsa önce tam hareketi, sonra yalnız x'i, sonra yalnız z'yi dener
 * (duvara paralel kayma). Hareket tümüyle engelliyse konum değişmez.
 */
export function walkStep(boxes: Box[], x: number, z: number, dx: number, dz: number, r = BODY_RADIUS): { x: number; z: number } {
  if (!blockedAt(boxes, x + dx, z + dz, r)) return { x: x + dx, z: z + dz }
  if (dx !== 0 && !blockedAt(boxes, x + dx, z, r)) return { x: x + dx, z }
  if (dz !== 0 && !blockedAt(boxes, x, z + dz, r)) return { x, z: z + dz }
  return { x, z }
}

/** (x, z) engelliyse en yakın boş noktayı (0,5 m adımlı sarmal arama, ≤ 25 m) bulur. */
export function freeSpot(boxes: Box[], x: number, z: number, r = BODY_RADIUS): { x: number; z: number } {
  if (!blockedAt(boxes, x, z, r)) return { x, z }
  for (let ring = 1; ring <= 50; ring++) {
    const d = ring * 0.5
    for (let k = 0; k < 8 * ring; k++) {
      const a = (k / (8 * ring)) * Math.PI * 2
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      if (!blockedAt(boxes, px, pz, r)) return { x: px, z: pz }
    }
  }
  return { x, z }
}

/** Yaw (rad) ve ileri hız bileşenleri: yaw 0 → −z yönüne bakar. */
export const forwardOf = (yaw: number): { x: number; z: number } => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const rightOf = (yaw: number): { x: number; z: number } => ({ x: Math.cos(yaw), z: -Math.sin(yaw) })
