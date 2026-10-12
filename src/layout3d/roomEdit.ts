import type { Oda3D, OdaTuru } from '../model/types'
import { snap } from './geometry'

/** Yeni odanın tür başına varsayılan boyutu (genişlik × derinlik × yükseklik, m). */
export const ROOM_PRESETS: Record<OdaTuru, { g: number; d: number; y: number; ad: string }> = {
  elektrik: { g: 12, d: 8, y: 3.5, ad: 'Elektrik odası' },
  salon: { g: 24, d: 14, y: 4, ad: 'Veri salonu' },
  jenerator: { g: 16, d: 8, y: 3, ad: 'Jeneratör alanı' },
  dis: { g: 20, d: 12, y: 3, ad: 'Dış alan' },
}

/** Üst kat kotu (m): kat süzgeci "1. kat" iken yeni oda bu kotta açılır. */
export const UPPER_ELEV = 4.5

/** Odalar için en küçük yapışma adımı: ince ızgara (0,1 m) seçili olsa bile oda kenarları 0,5 m'ye oturur. */
export const roomStep = (step: number): number => (step >= 0.5 ? step : 0.5)

/** En küçük oda boyutu (m). */
export const MIN_ROOM = 2

/** Verilen merkeze (cx, cz) yeni oda tanımı: ızgaraya oturur, adı benzersizdir. */
export function newRoomAt(rooms: Oda3D[], tur: OdaTuru, cx: number, cz: number, step: number, upper = false): Omit<Oda3D, 'id'> {
  const p = ROOM_PRESETS[tur]
  const s = roomStep(step)
  const n = rooms.filter((r) => r.tur === tur).length
  let k = n + 1
  while (rooms.some((r) => r.ad === `${p.ad} ${k}`)) k++
  return {
    ad: `${p.ad} ${k}`,
    tur,
    x: snap(cx - p.g / 2, s),
    z: snap(cz - p.d / 2, s),
    g: p.g,
    d: p.d,
    y: p.y,
    ...(upper ? { elev: UPPER_ELEV } : {}),
  }
}

/** Oda tutamacı: taşı, kenar (n = −z/kuzey, s, e, w) veya köşe. */
export type RoomHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Tutamaç sürüklenince odanın yeni konumu/boyutu. `dx`, `dz`: başlangıçtan fare farkı (m). Kenarlar ızgaraya oturur, karşı kenar
 * sabit kalır, boyut MIN_ROOM'dan küçülmez.
 */
export function resizeRoom(start: Pick<Oda3D, 'x' | 'z' | 'g' | 'd'>, mode: RoomHandle, dx: number, dz: number, step: number): Pick<Oda3D, 'x' | 'z' | 'g' | 'd'> {
  const s = roomStep(step)
  if (mode === 'move') return { x: snap(start.x + dx, s), z: snap(start.z + dz, s), g: start.g, d: start.d }
  let x0 = start.x
  let x1 = start.x + start.g
  let z0 = start.z
  let z1 = start.z + start.d
  if (mode.includes('w')) x0 = Math.min(snap(start.x + dx, s), x1 - MIN_ROOM)
  if (mode.includes('e')) x1 = Math.max(snap(start.x + start.g + dx, s), x0 + MIN_ROOM)
  if (mode.includes('n')) z0 = Math.min(snap(start.z + dz, s), z1 - MIN_ROOM)
  if (mode.includes('s')) z1 = Math.max(snap(start.z + start.d + dz, s), z0 + MIN_ROOM)
  return { x: x0, z: z0, g: Math.round((x1 - x0) * 1e6) / 1e6, d: Math.round((z1 - z0) * 1e6) / 1e6 }
}
