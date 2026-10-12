import type { Oda3D, Plan3D } from '../model/types'

/** Duvar çizgisi oda kenarına bu kadar yakınsa kenarın duvarı sayılır (çift çizgili duvarlar için), m. */
const TOL = 0.45
/** Bu genişliğe kadar boşluklar kapı/açıklık sayılır (m); daha geniş boşluk açık kenardır. */
export const DOOR_MAX = 3.2
const DOOR_MIN = 0.7

export type Side = 'kuzey' | 'guney' | 'bati' | 'dogu'

export interface SideInfo {
  side: Side
  /** Duvarla örtülü oran (0..1). */
  cover: number
  /** Kenar boyunca duvarsız aralıklar [başlangıç, bitiş] (kuzey/güney: x, batı/doğu: z), ≥ 0,3 m. */
  gaps: [number, number][]
  /** Kenarın sabit koordinatı (kuzey/güney: z, batı/doğu: x). */
  fixed: number
  /** Kenar boyunca aralık: [a0, a1]. */
  span: [number, number]
}

type Room = Pick<Oda3D, 'x' | 'z' | 'g' | 'd'>
type Wall = [number, number, number, number]

/** Oda kenarlarının duvar örtüsü ve boşlukları. */
export function roomSides(room: Room, walls: Wall[]): SideInfo[] {
  const defs: { side: Side; horiz: boolean; fixed: number; a0: number; a1: number }[] = [
    { side: 'kuzey', horiz: true, fixed: room.z, a0: room.x, a1: room.x + room.g },
    { side: 'guney', horiz: true, fixed: room.z + room.d, a0: room.x, a1: room.x + room.g },
    { side: 'bati', horiz: false, fixed: room.x, a0: room.z, a1: room.z + room.d },
    { side: 'dogu', horiz: false, fixed: room.x + room.g, a0: room.z, a1: room.z + room.d },
  ]
  return defs.map(({ side, horiz, fixed, a0, a1 }) => {
    const iv: [number, number][] = []
    for (const [x0, z0, x1, z1] of walls) {
      if (horiz && Math.abs(z0 - z1) < 0.06 && Math.abs(z0 - fixed) <= TOL) iv.push([Math.min(x0, x1), Math.max(x0, x1)])
      if (!horiz && Math.abs(x0 - x1) < 0.06 && Math.abs(x0 - fixed) <= TOL) iv.push([Math.min(z0, z1), Math.max(z0, z1)])
    }
    iv.sort((p, q) => p[0] - q[0])
    let cur = a0
    const gaps: [number, number][] = []
    for (const [s, e] of iv) {
      if (e < cur || s > a1) continue
      if (s > cur) gaps.push([cur, s])
      cur = Math.max(cur, e)
    }
    if (cur < a1) gaps.push([cur, a1])
    const big = gaps.filter(([a, b]) => b - a >= 0.3).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100] as [number, number])
    const open = big.reduce((s, [a, b]) => s + (b - a), 0)
    return { side, cover: 1 - open / (a1 - a0), gaps: big, fixed, span: [a0, a1] }
  })
}

export interface Entrance {
  /** Kapı boşluğunun merkezi (duvar çizgisi üzerinde). */
  x: number
  z: number
  /** Odadan dışarı bakan birim normal. */
  nx: number
  nz: number
  /** Boşluk genişliği (m); kapı bulunamadıysa 0 (kenar ortası). */
  width: number
  side: Side
}

const NORMAL: Record<Side, [number, number]> = { kuzey: [0, -1], guney: [0, 1], bati: [-1, 0], dogu: [1, 0] }

/**
 * Oda girişi: duvardaki kapı boşluğu (0,7–3,2 m; birden çok varsa en geniş). Boşluk yoksa (kapalı oda) güney kenar ortası.
 * Tabela kapı üstünde, odanın dışına bakacak biçimde konur.
 */
export function roomEntrance(room: Room, walls: Wall[]): Entrance {
  const sides = roomSides(room, walls)
  let best: { s: SideInfo; gap: [number, number] } | undefined
  for (const s of sides)
    for (const gap of s.gaps) {
      const w = gap[1] - gap[0]
      if (w < DOOR_MIN || w > DOOR_MAX) continue
      if (!best || w > best.gap[1] - best.gap[0]) best = { s, gap }
    }
  if (best) {
    const c = (best.gap[0] + best.gap[1]) / 2
    const horiz = best.s.side === 'kuzey' || best.s.side === 'guney'
    const [nx, nz] = NORMAL[best.s.side]
    return { x: horiz ? c : best.s.fixed, z: horiz ? best.s.fixed : c, nx, nz, width: best.gap[1] - best.gap[0], side: best.s.side }
  }
  return { x: room.x + room.g / 2, z: room.z + room.d, nx: 0, nz: 1, width: 0, side: 'guney' }
}

export interface RoomIssue {
  room: string
  /** 'acik': 3,2 m'den geniş duvarsız boşluk; 'bolucu': odayı baştan başa kesen duvar (oda ikiye bölünmeli); 'bos': ekipmansız ama plan ekipmanı dışında kalan. */
  tur: 'acik' | 'bolucu'
  ayrinti: string
}

/** Ekipman dikdörtgenlerinin dış hatlarını izleyen çizgiler (dolap sıraları) bölücü duvar sayılmaz. */
function isOutline(w: Wall, plan: Plan3D): boolean {
  const [x0, z0, x1, z1] = w
  const n = Math.max(2, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 0.3))
  for (let k = 0; k <= n; k++) {
    const px = x0 + ((x1 - x0) * k) / n
    const pz = z0 + ((z1 - z0) * k) / n
    if (!plan.ekipman.some((e) => Math.abs(px - e.x) <= e.g / 2 + 0.2 && Math.abs(pz - e.z) <= e.d / 2 + 0.2)) return false
  }
  return true
}

/**
 * Plan odalarını duvarlara karşı denetler: (1) kenarlarda kapı genişliğini (3,2 m) aşan duvarsız boşluk, (2) odayı baştan başa
 * (≥ %85) kesen duvar. `izinli` oda adları (ör. büyük salon) açık kenar için atlanır.
 */
export function checkRooms(plan: Plan3D, izinli: string[] = []): RoomIssue[] {
  const walls = plan.duvarlar.filter((w) => Math.hypot(w[2] - w[0], w[3] - w[1]) >= 1)
  const out: RoomIssue[] = []
  for (const r of plan.odalar) {
    if (!izinli.includes(r.ad)) {
      for (const s of roomSides(r, walls)) {
        const wide = s.gaps.filter(([a, b]) => b - a > DOOR_MAX)
        if (wide.length) out.push({ room: r.ad, tur: 'acik', ayrinti: `${s.side} kenarında ${wide.map(([a, b]) => `${(b - a).toFixed(1)} m`).join(', ')} boşluk` })
      }
    }
    for (const w of walls) {
      const [x0, z0, x1, z1] = w
      if (isOutline(w, plan)) continue
      if (Math.abs(z0 - z1) < 0.06 && z0 > r.z + 0.5 && z0 < r.z + r.d - 0.5) {
        const L = Math.min(Math.max(x0, x1), r.x + r.g) - Math.max(Math.min(x0, x1), r.x)
        if (L >= 0.85 * r.g) out.push({ room: r.ad, tur: 'bolucu', ayrinti: `z=${z0.toFixed(1)} yatay duvar (${L.toFixed(1)} m)` })
      }
      if (Math.abs(x0 - x1) < 0.06 && x0 > r.x + 0.5 && x0 < r.x + r.g - 0.5) {
        const L = Math.min(Math.max(z0, z1), r.z + r.d) - Math.max(Math.min(z0, z1), r.z)
        if (L >= 0.85 * r.d) out.push({ room: r.ad, tur: 'bolucu', ayrinti: `x=${x0.toFixed(1)} dikey duvar (${L.toFixed(1)} m)` })
      }
    }
  }
  return out
}
