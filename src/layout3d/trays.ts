import { CABLE_TABLE } from '../engine/cableSizing'
import type { Nokta3D, ProjectEdge, Tava3D } from '../model/types'

// --- kablo kesiti ve doluluk -----------------------------------------------------------

export interface CableSize {
  /** Paralel kablo sayısı (faz takımı başına çok damarlı kablo). */
  n: number
  /** Kesit, mm². */
  s: number
}

/**
 * Hattın kablo tanımı: önce açıklamadan ("2×150 mm² Cu/XLPE", "2x(4x95)+95 mm²"), yoksa akım kapasitesinden
 * (tabloda n·Iz ≥ kapasite sağlayan en az kablolu, en küçük kesitli seçenek) tahmin edilir.
 */
export function cableSizeOf(e: Pick<ProjectEdge, 'aciklama' | 'akimKapasitesi'>): CableSize {
  const text = e.aciklama ?? ''
  const nested = /(\d+)\s*[x×]\s*\(\s*\d+\s*[x×]\s*(\d+)\s*\)/i.exec(text)
  if (nested) return { n: Math.max(1, Number(nested[1])), s: Number(nested[2]) }
  const tool = /(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*mm²\s*Cu\/XLPE/i.exec(text)
  if (tool) return { n: Math.max(1, Number(tool[1])), s: Number(tool[2].replace(',', '.')) }
  const cores = /\b[345]\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*mm²/i.exec(text)
  if (cores) return { n: 1, s: Number(cores[1].replace(',', '.')) }
  const cap = Math.max(0, e.akimKapasitesi)
  for (let n = 1; n <= 8; n++) {
    const c = CABLE_TABLE.find((t) => t.iz * n >= cap)
    if (c) return { n, s: c.s }
  }
  return { n: 8, s: CABLE_TABLE[CABLE_TABLE.length - 1].s }
}

/** Çok damarlı (4 damar) XLPE kablonun dış çapı, mm: iletken alanının ≈ %35'i kablo kesiti (tipik). */
export const cableOdMm = (s: number): number => Math.sqrt((4 * ((4 * s) / 0.35)) / Math.PI)

/** Hattın tavada kapladığı toplam kesit alanı, mm². */
export const cableAreaMm2 = (c: CableSize): number => c.n * (Math.PI / 4) * cableOdMm(c.s) ** 2

// --- tava ağı ---------------------------------------------------------------------------

/** Tavaların kablo yolu kotu: tava tabanının biraz üstü, m. */
const LIFT = 0.08
/** Aynı kavşak sayılan uzaklık (x-z), m ve en çok kot farkı, m. */
const JOIN_XZ = 0.5
const JOIN_Y = 0.6
/** Ekipman bağlantı bacağı için izin verilen en uzun x-z uzaklığı, m. */
export const MAX_LEG = 30

interface Seg {
  a: number
  b: number
  tray: string
}

interface NetNode {
  x: number
  y: number
  z: number
}

export interface TrayRoute {
  /** Ekipman üstleri arasındaki ara noktalar (`guzergah3d`). */
  points: Nokta3D[]
  /** Güzergâhın üzerinden geçtiği tavalar. */
  trayIds: string[]
}

const d2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)

/** Bir noktanın (x, z) bir doğru parçasına izdüşümü: t ∈ [0, 1]. */
function project(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { t: number; x: number; z: number; dist: number } {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  const x = ax + dx * t
  const z = az + dz * t
  return { t, x, z, dist: d2(px, pz, x, z) }
}

/**
 * Tavaların ağı: tava köşeleri düğüm, ardışık köşeler kenardır; birbirine JOIN_XZ içinde değen tava uçları (T veya uç uca)
 * birleşir. Ekipmandan tavaya en yakın noktaya dik (L biçimli) bir bacakla çıkılır.
 */
export class TrayNet {
  nodes: NetNode[] = []
  segs: Seg[] = []

  constructor(trays: Tava3D[]) {
    // 1) T kavşakları: bir tavanın ucu başka tavanın bir parçasına değiyorsa o parçaya köşe eklenir.
    const polys = trays.map((t) => t.noktalar.map((p) => ({ x: p.x, z: p.z })))
    trays.forEach((t, ti) => {
      for (const end of [0, t.noktalar.length - 1]) {
        const e = t.noktalar[end]
        trays.forEach((o, oi) => {
          if (oi === ti || Math.abs(o.y - t.y) > JOIN_Y) return
          const poly = polys[oi]
          for (let i = 1; i < poly.length; i++) {
            const pr = project(e.x, e.z, poly[i - 1].x, poly[i - 1].z, poly[i].x, poly[i].z)
            if (pr.dist <= JOIN_XZ && pr.t > 1e-6 && pr.t < 1 - 1e-6) {
              poly.splice(i, 0, { x: pr.x, z: pr.z })
              break
            }
          }
        })
      }
    })
    // 2) Düğüm ve kenarlar
    const nodeFor = (x: number, y: number, z: number): number => {
      const k = this.nodes.findIndex((n) => d2(n.x, n.z, x, z) <= JOIN_XZ && Math.abs(n.y - y) <= JOIN_Y)
      if (k >= 0) return k
      this.nodes.push({ x, y, z })
      return this.nodes.length - 1
    }
    trays.forEach((t, ti) => {
      const poly = polys[ti]
      let prev = -1
      for (const p of poly) {
        const k = nodeFor(p.x, t.y, p.z)
        if (prev >= 0 && prev !== k) this.segs.push({ a: prev, b: k, tray: t.id })
        prev = k
      }
    })
  }

  private len(a: number, b: number): number {
    const p = this.nodes[a]
    const q = this.nodes[b]
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
  }

  /** (x, z) noktasına en yakın tava parçası. */
  nearest(x: number, z: number): { seg: number; t: number; p: NetNode; dist: number } | null {
    let best: { seg: number; t: number; p: NetNode; dist: number } | null = null
    this.segs.forEach((s, i) => {
      const a = this.nodes[s.a]
      const b = this.nodes[s.b]
      const pr = project(x, z, a.x, a.z, b.x, b.z)
      if (!best || pr.dist < best.dist) best = { seg: i, t: pr.t, p: { x: pr.x, y: a.y + (b.y - a.y) * pr.t, z: pr.z }, dist: pr.dist }
    })
    return best
  }

  /** İki ekipman üstü arasındaki en kısa tava güzergâhı; tava yoksa veya bacak çok uzunsa null. */
  route(from: Nokta3D, to: Nokta3D): TrayRoute | null {
    if (this.segs.length === 0) return null
    const A = this.nearest(from.x, from.z)
    const B = this.nearest(to.x, to.z)
    if (!A || !B || A.dist > MAX_LEG || B.dist > MAX_LEG) return null
    // Sanal düğümler: n (A), n+1 (B); adj: düğüm → [komşu, maliyet]
    const n = this.nodes.length
    const adj: [number, number][][] = Array.from({ length: n + 2 }, () => [])
    const link = (u: number, v: number, w: number) => {
      adj[u].push([v, w])
      adj[v].push([u, w])
    }
    const sa = n
    const sb = n + 1
    const split = new Map<number, { id: number; t: number }[]>()
    for (const [id, q] of [[sa, A], [sb, B]] as const) {
      const arr = split.get(q.seg) ?? []
      arr.push({ id, t: q.t })
      split.set(q.seg, arr)
    }
    this.segs.forEach((s, i) => {
      const cuts = (split.get(i) ?? []).slice().sort((p, q) => p.t - q.t)
      const chain = [{ id: s.a, t: 0 }, ...cuts, { id: s.b, t: 1 }]
      const L = this.len(s.a, s.b)
      for (let k = 1; k < chain.length; k++) link(chain[k - 1].id, chain[k].id, Math.max(1e-6, (chain[k].t - chain[k - 1].t) * L))
    })
    // Dijkstra (küçük ağ: dizi tabanlı)
    const dist = new Array<number>(n + 2).fill(Infinity)
    const prev = new Array<number>(n + 2).fill(-1)
    const done = new Array<boolean>(n + 2).fill(false)
    dist[sa] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
      if (u < 0 || u === sb) break
      done[u] = true
      for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w
        prev[v] = u
      }
    }
    if (!Number.isFinite(dist[sb])) return null
    const chain: number[] = []
    for (let u = sb; u >= 0; u = prev[u]) chain.unshift(u)
    const coord = (id: number): NetNode => (id === sa ? A.p : id === sb ? B.p : this.nodes[id])
    const pts: Nokta3D[] = []
    const push = (x: number, y: number, z: number) => {
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(last.x - x, last.y - y, last.z - z) > 1e-6) pts.push({ x, y, z })
    }
    // Çıkış bacağı: ekipman üstünden tava kotuna, x sonra z
    const ya = A.p.y + LIFT
    push(from.x, ya, from.z)
    push(A.p.x, ya, from.z)
    push(A.p.x, ya, A.p.z)
    for (const id of chain.slice(1, -1)) {
      const c = coord(id)
      push(c.x, c.y + LIFT, c.z)
    }
    const yb = B.p.y + LIFT
    push(B.p.x, yb, B.p.z)
    push(B.p.x, yb, to.z)
    push(to.x, yb, to.z)
    // Tavalar: zincirdeki kenarların tava kimlikleri
    const ids = new Set<string>()
    for (let k = 1; k < chain.length; k++) {
      const u = chain[k - 1]
      const v = chain[k]
      const base = (id: number) => (id === sa ? this.segs[A.seg] : id === sb ? this.segs[B.seg] : undefined)
      const s = this.segs.find((q) => (q.a === u && q.b === v) || (q.a === v && q.b === u)) ?? base(u) ?? base(v)
      if (s) ids.add(s.tray)
    }
    // Aynı tava parçası üzerindeki iki sanal düğüm
    if (A.seg === B.seg) ids.add(this.segs[A.seg].tray)
    return { points: pts, trayIds: [...ids] }
  }
}

// --- kullanım ve doluluk ----------------------------------------------------------------

export interface TrayUsage {
  trayId: string
  /** Tavada ilerleyen kablo uzunluğu, m. */
  lengthM: number
}

/** Kablo çokgeninin hangi tavaların üzerinden geçtiği: 0,25 m örneklerle, tava kotuna (±0,25 m) ve yarı genişliğine (+0,1 m) göre. */
export function usedTrays(trays: Tava3D[], poly: Nokta3D[]): TrayUsage[] {
  const lens = new Map<string, number>()
  const STEP = 0.25
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i]
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const n = Math.max(1, Math.ceil(L / STEP))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      const z = a.z + (b.z - a.z) * t
      let best: { id: string; d: number } | undefined
      for (const tr of trays) {
        if (Math.abs(y - (tr.y + LIFT)) > 0.25) continue
        for (let j = 1; j < tr.noktalar.length; j++) {
          const pr = project(x, z, tr.noktalar[j - 1].x, tr.noktalar[j - 1].z, tr.noktalar[j].x, tr.noktalar[j].z)
          if (pr.dist <= tr.g / 2 + 0.1 && (!best || pr.dist < best.d)) best = { id: tr.id, d: pr.dist }
        }
      }
      if (best) lens.set(best.id, (lens.get(best.id) ?? 0) + L / n)
    }
  }
  return [...lens.entries()].map(([trayId, lengthM]) => ({ trayId, lengthM }))
}

export interface TrayFillRow {
  tray: Tava3D
  cables: number
  /** Kabloların toplam kesiti, mm². */
  areaMm2: number
  /** Tava iç kesiti (genişlik × yan yükseklik), mm². */
  sectionMm2: number
  /** Doluluk, % (kablo alanı / tava kesiti). */
  fillPct: number
  status: 'ok' | 'warn' | 'over'
  /** Tava uzunluğu, m. */
  lengthM: number
}

export const trayLength = (t: Tava3D): number => {
  let s = 0
  for (let i = 1; i < t.noktalar.length; i++) s += d2(t.noktalar[i - 1].x, t.noktalar[i - 1].z, t.noktalar[i].x, t.noktalar[i].z)
  return s
}

/** Tava doluluk tablosu: bir kablo, tavada ≥ 1 m ilerliyorsa o tavada sayılır. */
export function trayFillRows(trays: Tava3D[], cables: { id: string; poly: Nokta3D[]; area: number }[]): TrayFillRow[] {
  const acc = new Map<string, { n: number; area: number }>()
  for (const c of cables) {
    for (const u of usedTrays(trays, c.poly)) {
      if (u.lengthM < 1) continue
      const cur = acc.get(u.trayId) ?? { n: 0, area: 0 }
      cur.n += 1
      cur.area += c.area
      acc.set(u.trayId, cur)
    }
  }
  return trays.map((tray) => {
    const a = acc.get(tray.id) ?? { n: 0, area: 0 }
    const section = tray.g * 1000 * tray.h * 1000
    const fill = section > 0 ? (a.area / section) * 100 : 0
    return {
      tray,
      cables: a.n,
      areaMm2: a.area,
      sectionMm2: section,
      fillPct: fill,
      status: fill > tray.sinir * 1.15 ? 'over' : fill > tray.sinir ? 'warn' : 'ok',
      lengthM: trayLength(tray),
    }
  })
}
