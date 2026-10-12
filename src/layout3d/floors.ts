import type { Oda3D } from '../model/types'

/** Kat yüksekliği (döşemeden döşemeye), m. 1. kat kotu = KAT_YUKSEKLIGI. */
export const KAT_YUKSEKLIGI = 4.5
/** Döşeme kalınlığı, m (üst yüzey oda kotundadır). */
export const DOSEME = 0.3

/** Merdiven ölçüleri (m). */
export const RISER = 0.18
export const TREAD = 0.28
export const STAIR_WIDTH = 1.2

/** Dış merdiven: (x, z) alt basamağın orta noktası; `a` çıkış yönü (rad, +x'ten +z'ye); `run` yatay boy. */
export interface Merdiven {
  id: string
  x: number
  z: number
  a: number
  g: number
  run: number
  elev0: number
  elev1: number
  /** Üst sahanlık derinliği (çıkış yönünde), m. */
  sahanlik: number
}

/** Üst kat döşemesi (yürünebilir yüzey). */
export interface Doseme {
  roomId: string
  x: number
  z: number
  g: number
  d: number
  elev: number
}

export const elevOf = (r: Pick<Oda3D, 'elev'>): number => r.elev ?? 0

/** Kat numarası: 0 = zemin, 1 = 1. kat… (kot 0,5 m toleransla KAT_YUKSEKLIGI'ne bölünür). */
export const floorOf = (elev: number): number => Math.max(0, Math.floor((elev + 0.5) / KAT_YUKSEKLIGI))

export type FloorFilter = 'tum' | 'zemin' | 'kat1'

/** Bu kottaki öğe seçili kat süzgecinde görünür mü. Kat süzgeci 'tum' ise hepsi. */
export function floorVisible(filter: FloorFilter, elev: number): boolean {
  if (filter === 'tum') return true
  const f = floorOf(elev)
  return filter === 'zemin' ? f === 0 : f >= 1
}

/** Üst kat döşemeleri (elev > 0 olan odalar). */
export function slabsOf(rooms: Oda3D[]): Doseme[] {
  return rooms.filter((r) => elevOf(r) > 0.01).map((r) => ({ roomId: r.id, x: r.x, z: r.z, g: r.g, d: r.d, elev: elevOf(r) }))
}

/**
 * Üst kat odaları için dış merdivenler (türetilir, saklanmaz): her üst kat odasının batı duvarına dik, +x yönünde
 * çıkan, üst ucu duvara (döşemeye) değen düz kollu merdiven. Merdiven orta noktası odanın ön kenarından 3 m içeridedir.
 */
export function autoStairs(rooms: Oda3D[]): Merdiven[] {
  const out: Merdiven[] = []
  for (const r of rooms) {
    const e = elevOf(r)
    if (e <= 0.01) continue
    const steps = Math.max(2, Math.round(e / RISER))
    const run = steps * TREAD
    out.push({
      id: `merdiven-${r.id}`,
      x: r.x - run,
      z: r.z + Math.min(3, r.d / 2),
      a: 0,
      g: STAIR_WIDTH,
      run,
      elev0: 0,
      elev1: e,
      sahanlik: 0,
    })
  }
  return out
}

/** Merdiven yerel koordinatı: u çıkış yönünde alt uçtan, v yanal. */
export function stairLocal(s: Merdiven, x: number, z: number): { u: number; v: number } {
  const dx = x - s.x
  const dz = z - s.z
  const c = Math.cos(s.a)
  const sn = Math.sin(s.a)
  return { u: dx * c + dz * sn, v: -dx * sn + dz * c }
}

/** (x, z) merdiven üzerindeyse basamak yüzeyi kotu, değilse null. Rampa olarak sürekli (basamak yüksekliği ≈ 0,18 m). */
export function stairHeightAt(s: Merdiven, x: number, z: number): number | null {
  const { u, v } = stairLocal(s, x, z)
  if (u < -1e-9 || u > s.run + s.sahanlik + 1e-9 || Math.abs(v) > s.g / 2) return null
  const t = Math.min(1, u / s.run)
  return s.elev0 + (s.elev1 - s.elev0) * t
}

/** Bir kotta tek adımda çıkılabilen yükseklik (basamak/eşik), m. */
export const MAX_STEP = 0.45
/** Bir adımda inilebilen en büyük düşüş (korkuluk/kenar sayılır, daha fazlası engeldir), m. */
export const MAX_DROP = 0.6

/**
 * (x, z) noktasında, ayaklar `cur` kotundayken basılacak yüzey kotu. Aday yüzeyler: zemin (0), üst kat döşemeleri, merdiven.
 * `cur + MAX_STEP`'i aşmayan en yüksek aday seçilir; `cur − MAX_DROP`'tan alçaksa (kenardan düşme) null → hareket engelli.
 */
export function surfaceHeight(rooms: Oda3D[], stairs: Merdiven[], x: number, z: number, cur: number): number | null {
  let best = 0
  for (const sl of slabsOf(rooms)) {
    if (x >= sl.x && x <= sl.x + sl.g && z >= sl.z && z <= sl.z + sl.d && sl.elev <= cur + MAX_STEP && sl.elev > best) best = sl.elev
  }
  for (const s of stairs) {
    const h = stairHeightAt(s, x, z)
    if (h !== null && h <= cur + MAX_STEP && h > best) best = h
  }
  return best < cur - MAX_DROP ? null : best
}

/** Başlangıç için: ipucu kotuna (hint) en yakın alttaki yüzey (düşme/engel denetimi yok). */
export function floorAt(rooms: Oda3D[], stairs: Merdiven[], x: number, z: number, hint: number): number {
  let best = 0
  for (const sl of slabsOf(rooms)) {
    if (x >= sl.x && x <= sl.x + sl.g && z >= sl.z && z <= sl.z + sl.d && sl.elev <= hint + MAX_STEP && sl.elev > best) best = sl.elev
  }
  for (const s of stairs) {
    const h = stairHeightAt(s, x, z)
    if (h !== null && h <= hint + MAX_STEP && h > best) best = h
  }
  return best
}
