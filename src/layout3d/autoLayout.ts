import { coolingKw } from '../engine/coolingUnits'
import type { Model } from '../engine/types'
import type { Oda3D, OdaTuru, ProjectNode, Yerlesim3D } from '../model/types'
import { dimsOf, isMinor, zoneOf } from './dims'
import { KAT_YUKSEKLIGI } from './floors'
import { mountOnFace } from './faceMount'
import { boxOf, bounds, roomAt } from './geometry'
import type { Box } from './geometry'

/** Odaların alt alta dizilme sırası. */
const ZONE_ORDER: OdaTuru[] = ['dis', 'jenerator', 'elektrik', 'salon']
const ZONE_NAME: Record<OdaTuru, string> = { elektrik: 'Elektrik odası', salon: 'Veri salonu', jenerator: 'Jeneratör alanı', dis: 'Dış alan' }
const ZONE_HEIGHT: Record<OdaTuru, number> = { elektrik: 3.5, salon: 4, jenerator: 3.5, dis: 3 }

const MAX_ROW = 36 // m
const GAP = 0.5 // yan yana ekipman arası, m
const ROOM_PAD = 1.5
const ZONE_GAP = 5
const YARD_GAP = 14 // bina ile avlu (jeneratör, dış ekipman) arası, m

export interface LayoutResult {
  placements: Record<string, Yerlesim3D>
  /** 'all' kipinde üretilen odalar; 'missing' kipinde boş. */
  rooms: Oda3D[]
}

/** Şema derinliği: kaynaklardan en uzun yol (kesici/ölçü elemanları seviye artırmaz). Döngüde sonlanır. */
export function levels(model: Model): Map<string, number> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, string[]>()
  for (const n of model.nodes) incoming.set(n.id, [])
  for (const e of model.edges) if (byId.has(e.source) && byId.has(e.target)) incoming.get(e.target)!.push(e.source)
  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  const lv = (id: string): number => {
    const got = memo.get(id)
    if (got !== undefined) return got
    if (visiting.has(id)) return 0
    visiting.add(id)
    const ups = incoming.get(id) ?? []
    const step = isMinor(byId.get(id)!.type) ? 0 : 1
    const v = ups.length === 0 ? 0 : Math.max(...ups.map((u) => lv(u))) + step
    visiting.delete(id)
    memo.set(id, v)
    return v
  }
  for (const n of model.nodes) lv(n.id)
  return memo
}

const label = (n: ProjectNode) => n.ad || n.id

/** Küçük elemanın bağlı olduğu ana ekipman: önce yukarı akış, yoksa aşağı akış (küçük elemanlar atlanır). */
export function anchorOf(model: Model, id: string, byId: Map<string, ProjectNode>): string | undefined {
  for (const dir of ['up', 'down'] as const) {
    const seen = new Set<string>([id])
    let frontier = [id]
    for (let depth = 0; depth < 12 && frontier.length; depth++) {
      const next: string[] = []
      for (const cur of frontier) {
        for (const e of model.edges) {
          const other = dir === 'up' ? (e.target === cur ? e.source : undefined) : e.source === cur ? e.target : undefined
          if (!other || seen.has(other) || !byId.has(other)) continue
          seen.add(other)
          if (!isMinor(byId.get(other)!.type)) return other
          next.push(other)
        }
      }
      frontier = next
    }
  }
  return undefined
}

interface RowItem {
  node: ProjectNode
  g: number
  d: number
}

/** Satırlara paketler; öğelerin yerel (x,z) merkezlerini ve toplam boyutu döndürür. */
function packGroups(groups: RowItem[][], aisle: (groupIndex: number) => number, maxRow = MAX_ROW): { pos: Map<string, { x: number; z: number }>; w: number; d: number } {
  const pos = new Map<string, { x: number; z: number }>()
  let z = 0
  let maxW = 0
  groups.forEach((items, gi) => {
    let x = 0
    let rowD = 0
    let rowStart = z
    const flush = () => {
      maxW = Math.max(maxW, x - GAP)
      z = rowStart + rowD + aisle(gi)
      rowStart = z
      x = 0
      rowD = 0
    }
    for (const it of items) {
      if (x > 0 && x + it.g > maxRow) flush()
      pos.set(it.node.id, { x: x + it.g / 2, z: rowStart + it.d / 2 })
      x += it.g + GAP
      rowD = Math.max(rowD, it.d)
    }
    if (items.length) flush()
  })
  return { pos, w: maxW, d: Math.max(0, z - aisle(groups.length - 1)) }
}

/** Bölgedeki ana ekipmanı şema seviyesine göre satırlara paketler (ekipman yoksa undefined). Yerel (x, z) merkezleri döner. */
export function packZone(major: ProjectNode[], zone: OdaTuru, lv: Map<string, number>, maxRow = MAX_ROW) {
  const inZone = major.filter((n) => zoneOf(n) === zone)
  if (!inZone.length) return undefined
  // Grup anahtarı: soğutma birimleri -1 (salonda ilk satır), diğerleri şema seviyesi.
  const keyOf = (n: ProjectNode) => (zone === 'salon' && coolingKw(n) > 0 ? -1 : lv.get(n.id) ?? 0)
  const keys = [...new Set(inZone.map(keyOf))].sort((a, b) => a - b)
  const groups: RowItem[][] = keys.map((k) =>
    inZone
      .filter((n) => keyOf(n) === k)
      .sort((a, b) => label(a).localeCompare(label(b), 'tr'))
      .map((n) => ({ node: n, g: dimsOf(n).g, d: dimsOf(n).d })),
  )
  const aisleFor = (gi: number) => {
    const row = groups[Math.max(0, gi)] ?? []
    return row.some((r) => r.node.type === 'rack' || r.node.type === 'itYuku') ? 2.4 : 2.2
  }
  return { inZone, packed: packGroups(groups, aisleFor, maxRow) }
}

/**
 * Otomatik yerleşim. `all`: tüm ekipman yeniden dizilir ve odalar üretilir (elektrik zinciri seviyesine göre satırlar;
 * soğutma birimleri salonun ilk satırı). `missing`: yalnızca `yerlesim3d` olmayan ekipman, mevcut yerleşimin altına dizilir.
 */
export function autoLayout(model: Model, mode: 'all' | 'missing', rooms: Oda3D[] = []): LayoutResult {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const lv = levels(model)
  const todo = model.nodes.filter((n) => mode === 'all' || !n.yerlesim3d)
  const major = todo.filter((n) => !isMinor(n.type))
  const minor = todo.filter((n) => isMinor(n.type))
  const placements: Record<string, Yerlesim3D> = {}
  const outRooms: Oda3D[] = []

  // Başlangıç noktası: eksik kipinde mevcut yerleşimin altı
  let originX = 0
  let originZ = 0
  if (mode === 'missing') {
    const exist = model.nodes.filter((n) => n.yerlesim3d && !isMinor(n.type))
    if (exist.length) {
      const bs = exist.map((n) => bounds({ x: n.yerlesim3d!.x, z: n.yerlesim3d!.z, g: dimsOf(n).g, d: dimsOf(n).d, rot: n.yerlesim3d!.rot ?? 0 }))
      originX = Math.min(...bs.map((b) => b.minX))
      originZ = Math.max(...bs.map((b) => b.maxZ)) + ZONE_GAP
    }
  }

  const packOf = (zone: OdaTuru) => packZone(major, zone, lv)
  const margin = mode === 'all' ? ROOM_PAD : 0
  const place = (zone: OdaTuru, pk: NonNullable<ReturnType<typeof packOf>>, ox: number, oz: number, w: number, d: number, elev: number) => {
    const room: Oda3D = { id: `oda-${zone}`, ad: ZONE_NAME[zone], tur: zone, x: ox - margin, z: oz - margin, g: w + 2 * margin, d: d + 2 * margin, y: ZONE_HEIGHT[zone], ...(elev > 0 ? { elev } : {}) }
    for (const n of pk.inZone) {
      const p = pk.packed.pos.get(n.id)!
      placements[n.id] = { x: ox + p.x, z: oz + p.z, ...(elev > 0 ? { elev } : {}), ...(mode === 'all' ? { oda: room.id } : {}) }
    }
    if (mode === 'all') outRooms.push(room)
    return room
  }

  let cursorZ = originZ
  if (mode === 'all') {
    // Katlı bina: elektrik odası zemin katta, veri salonu 1. katta (aynı ayak izi); jeneratör ve dış ekipman bina dışında (avlu, doğuda).
    const pe = packOf('elektrik')
    const ps = packOf('salon')
    const upper = !!pe && !!ps
    const bw = Math.max(pe?.packed.w ?? 0, ps?.packed.w ?? 0)
    const bd = Math.max(pe?.packed.d ?? 0, ps?.packed.d ?? 0)
    if (pe) place('elektrik', pe, originX, originZ, bw, bd, 0)
    if (ps) place('salon', ps, originX, originZ, bw, bd, upper ? KAT_YUKSEKLIGI : 0)
    let yardZ = originZ
    // Bina yoksa avlu sol kenardan başlar.
    const yardX = pe || ps ? originX + bw + 2 * margin + YARD_GAP : originX
    for (const zone of ['jenerator', 'dis'] as const) {
      const pk = packOf(zone)
      if (!pk) continue
      place(zone, pk, yardX, yardZ, pk.packed.w, pk.packed.d, 0)
      yardZ += pk.packed.d + 2 * margin + ZONE_GAP
    }
    cursorZ = Math.max(yardZ, originZ + bd + 2 * margin + ZONE_GAP)
  } else {
    for (const zone of ZONE_ORDER) {
      const pk = packOf(zone)
      if (!pk) continue
      place(zone, pk, originX, cursorZ, pk.packed.w, pk.packed.d, 0)
      cursorZ += pk.packed.d + 2 * margin + ZONE_GAP
    }
  }

  // Küçük elemanlar (kesici, ölçü): bağlı oldukları ana ekipmanın ön yüzüne oturur (şalter MSB'nin üzerinde görünür).
  const merged = new Map<string, Yerlesim3D>()
  for (const n of model.nodes) if (n.yerlesim3d) merged.set(n.id, n.yerlesim3d)
  for (const [id, l] of Object.entries(placements)) merged.set(id, l)
  const layoutModel: Model = { nodes: model.nodes.map((n) => ({ ...n, yerlesim3d: merged.get(n.id) })), edges: model.edges }
  const mounts = mountPatches(layoutModel, new Set(minor.map((n) => n.id)))
  const fallback = { x: originX, z: cursorZ }
  let fi = 0
  for (const n of minor) {
    const m = mounts[n.id]
    if (m) {
      const anchorLayout = (() => {
        const a = anchorOf(model, n.id, byId)
        return a ? merged.get(a) : undefined
      })()
      placements[n.id] = { ...m, ...(anchorLayout?.oda ? { oda: anchorLayout.oda } : {}) }
    } else {
      placements[n.id] = { x: fallback.x + (fi++) * 0.6, z: fallback.z }
    }
  }

  // Eksik kipinde: yerleşen ekipmana mevcut odalardan biri atanır.
  if (mode === 'missing' && rooms.length) {
    for (const [id, l] of Object.entries(placements)) {
      const r = roomAt(rooms, l.x, l.z)
      if (r) placements[id] = { ...l, oda: r.id }
    }
  }
  return { placements, rooms: outRooms }
}

/** Yerleşimi (kayıtlı veya önerilen) kutulara çevirir. */
export function boxesOf(nodes: ProjectNode[], overrides: Record<string, Yerlesim3D> = {}): Box[] {
  const out: Box[] = []
  for (const n of nodes) {
    const l = overrides[n.id] ?? n.yerlesim3d
    if (l) out.push(boxOf(n.id, n.type, l, dimsOf({ ...n, yerlesim3d: l })))
  }
  return out
}

/**
 * Her küçük elemanın (kesici, ölçü) bağlı olduğu ana ekipman → ana ekipman başına takipçi listesi. Ana ekipman taşınırken
 * takipçileri onunla birlikte taşınır.
 */
export function followersOf(model: Model): Map<string, string[]> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const out = new Map<string, string[]>()
  for (const n of model.nodes) {
    if (!isMinor(n.type)) continue
    const a = anchorOf(model, n.id, byId)
    if (a) out.set(a, [...(out.get(a) ?? []), n.id])
  }
  return out
}

/**
 * Küçük elemanları (kesici, ölçü) ana ekipmanlarının ön yüzüne oturtur. `only` verilirse yalnız o elemanlar; ana ekipmanın
 * yerleşimi yoksa atlanır. Sonuç `yerlesim3d` (mont: true) biçimindedir.
 */
export function mountPatches(model: Model, only?: Set<string>): Record<string, Yerlesim3D> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const out: Record<string, Yerlesim3D> = {}
  for (const [anchorId, ids] of followersOf(model)) {
    const a = byId.get(anchorId)
    if (!a?.yerlesim3d) continue
    const items = ids
      .filter((id) => !only || only.has(id))
      .map((id) => {
        const n = byId.get(id)!
        const d = dimsOf(n)
        return { id, g: d.g, d: d.d, h: d.y }
      })
    if (items.length === 0) continue
    const dm = dimsOf(a)
    Object.assign(out, mountOnFace({ x: a.yerlesim3d.x, z: a.yerlesim3d.z, g: dm.g, d: dm.d, h: dm.y, rot: a.yerlesim3d.rot ?? 0, elev: a.yerlesim3d.elev ?? 0 }, items))
  }
  return out
}
