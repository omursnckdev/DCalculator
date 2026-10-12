import type { Model } from '../engine/types'
import type { Oda3D, Plan3D, ProjectNode, Yerlesim3D } from '../model/types'
import { levels, mountPatches, packZone } from './autoLayout'
import { isMinor } from './dims'
import { roomAt } from './geometry'

/** Plan dışı ekipman için avlu ile bina arası boşluk (m). */
const YARD_GAP = 14
const ZONE_GAP = 5
const ROOM_PAD = 1.5

export interface PlanResult {
  placements: Record<string, Yerlesim3D>
  rooms: Oda3D[]
  /** Plandaki dikdörtgenle eşleşen düğüm sayısı (küçük elemanlar hariç). */
  matched: number
  /** Planda karşılığı olmayan, otomatik yerleşen ana ekipman sayısı. */
  unmatched: number
  /** Planda olup şemada karşılığı bulunmayan etiketler. */
  unused: string[]
}

const norm = (s: string): string => s.trim().toUpperCase()

/** Düğümün plan etiketi adayları: önce "Etiket" alanı, sonra ad (tam, ilk sözcük, parantez öncesi). */
export function tagCandidates(n: Pick<ProjectNode, 'ad' | 'etiket'>): string[] {
  const out: string[] = []
  if (n.etiket) out.push(norm(n.etiket))
  const ad = norm(n.ad)
  out.push(ad)
  const first = ad.split(/\s+/)[0]
  if (first) out.push(first)
  const beforeParen = ad.split('(')[0].trim()
  if (beforeParen) out.push(beforeParen)
  return [...new Set(out)]
}

/**
 * Kat planını modele uygular: etiketi eşleşen ana ekipman plandaki dikdörtgenin merkezine ve boyutuna oturur (zemin kat, kot 0);
 * planda olmayanlar bölgeye göre yerleşir: veri salonu bölgesi (IT, soğutma) plandaki "salon" odasının içine, jeneratör ve dış
 * ekipman binanın doğusundaki avluya, diğer elektrik ekipmanı binanın güneyindeki şeride. Küçük elemanlar (şalter, ölçü)
 * bağlı oldukları ekipmanın ön yüzüne oturur. Sonuç tüm düğümleri kapsar (elle yerleşim korunmaz).
 */
export function applyPlan(model: Model, plan: Plan3D): PlanResult {
  const byTag = new Map(plan.ekipman.map((e) => [norm(e.etiket), e]))
  const usedTags = new Set<string>()
  const placements: Record<string, Yerlesim3D> = {}
  const rooms: Oda3D[] = plan.odalar.map((o, i) => ({ ...o, id: `plan-oda-${i + 1}` }))

  const major = model.nodes.filter((n) => !isMinor(n.type))
  const rest: ProjectNode[] = []
  let matched = 0
  // Etiket başına adaylar: birden çok düğüm aynı ilk sözcüğü paylaşabilir (ör. "STSSB.PL1.1A A girişi / B girişi / çıkış barası").
  const cands = new Map<string, { n: ProjectNode; score: number }[]>()
  for (const n of major) {
    const tags = tagCandidates(n)
    const tag = tags.find((t) => byTag.has(t))
    if (!tag) continue
    const exact = !!n.etiket && norm(n.etiket) === tag ? 3 : norm(n.ad) === tag ? 3 : n.type === 'sebeke' ? 0 : n.type === 'bara' ? 1 : 2
    cands.set(tag, [...(cands.get(tag) ?? []), { n, score: exact }])
  }
  const claimed = new Set<string>()
  for (const [tag, list] of cands) {
    const e = byTag.get(tag)!
    list.sort((a, b) => b.score - a.score)
    const [primary, ...others] = list
    usedTags.add(tag)
    matched++
    claimed.add(primary.n.id)
    const base = {
      x: Math.round(e.x * 100) / 100,
      z: Math.round(e.z * 100) / 100,
      g: Math.max(0.2, Math.min(40, e.g)),
      d: Math.max(0.2, Math.min(40, e.d)),
      ...(e.rot ? { rot: e.rot } : {}),
    }
    placements[primary.n.id] = base
    // Aynı dolabın içindeki baralar: aynı ayak izi, üst üste kotlarda (0,5 m aralık)
    let k = 1
    for (const o of others) {
      if (o.n.type !== 'bara') continue
      claimed.add(o.n.id)
      matched++
      placements[o.n.id] = { ...base, elev: Math.round(k * 0.5 * 100) / 100 }
      k++
    }
  }
  for (const n of major) if (!claimed.has(n.id)) rest.push(n)

  // Plan dışı ekipman
  const lv = levels(model)
  const salon = rooms.find((r) => r.tur === 'salon')
  const yardX = plan.g + YARD_GAP
  let yardZ = 0
  const place = (zone: 'salon' | 'jenerator' | 'dis' | 'elektrik', ox: number, oz: number, maxRow: number, room?: Oda3D): { w: number; d: number } => {
    const pk = packZone(rest, zone, lv, maxRow)
    if (!pk) return { w: 0, d: 0 }
    for (const n of pk.inZone) {
      const p = pk.packed.pos.get(n.id)!
      placements[n.id] = { x: Math.round((ox + p.x) * 100) / 100, z: Math.round((oz + p.z) * 100) / 100, ...(room ? { oda: room.id } : {}) }
    }
    return { w: pk.packed.w, d: pk.packed.d }
  }
  // Veri salonu bölgesi: salon odasının içine (oda yoksa binanın sol üst köşesine)
  if (salon) {
    place('salon', salon.x + 2, salon.z + 2, Math.max(6, salon.g - 4), salon)
  } else {
    const r = place('salon', 2, 2, Math.max(6, plan.g * 0.5))
    if (r.w > 0) rooms.push({ id: 'plan-oda-salon', ad: 'Veri salonu', tur: 'salon', x: 0.5, z: 0.5, g: r.w + 3, d: r.d + 3, y: 4.5 })
  }
  // Avlu: jeneratör, sonra dış ekipman (chiller, kule, sebeke...)
  for (const zone of ['jenerator', 'dis'] as const) {
    const r = place(zone, yardX, yardZ + ROOM_PAD, 36)
    if (r.w > 0) {
      rooms.push({ id: `plan-oda-${zone}`, ad: zone === 'jenerator' ? 'Jeneratör alanı' : 'Dış alan', tur: zone, x: yardX - ROOM_PAD, z: yardZ, g: r.w + 2 * ROOM_PAD, d: r.d + 2 * ROOM_PAD, y: 3 })
      yardZ += r.d + 2 * ROOM_PAD + ZONE_GAP
    }
  }
  // Planda yeri olmayan elektrik ekipmanı: binanın güneyinde şerit
  const south = plan.d + 8
  const er = place('elektrik', ROOM_PAD, south + ROOM_PAD, 36)
  if (er.w > 0) rooms.push({ id: 'plan-oda-elektrik-ek', ad: 'Elektrik odası (planda yok)', tur: 'elektrik', x: 0, z: south, g: er.w + 2 * ROOM_PAD, d: er.d + 2 * ROOM_PAD, y: 3.5 })

  // Oda ataması (planda yer alanlar)
  for (const [id, l] of Object.entries(placements)) {
    if (l.oda) continue
    const r = roomAt(rooms, l.x, l.z, 0)
    if (r) placements[id] = { ...l, oda: r.id }
  }

  // Küçük elemanlar: ana ekipmanın ön yüzü
  const merged: Model = { nodes: model.nodes.map((n) => ({ ...n, yerlesim3d: placements[n.id] })), edges: model.edges }
  const minors = new Set(model.nodes.filter((n) => isMinor(n.type)).map((n) => n.id))
  const mounts = mountPatches(merged, minors)
  let fi = 0
  for (const id of minors) {
    const m = mounts[id]
    if (m) {
      placements[id] = m
    } else {
      placements[id] = { x: 2 + (fi++) * 0.6, z: south + 2 }
    }
  }
  for (const id of minors) {
    const l = placements[id]
    if (l && !l.oda) {
      const r = roomAt(rooms, l.x, l.z, 0)
      if (r) placements[id] = { ...l, oda: r.id }
    }
  }

  const unused = plan.ekipman.map((e) => e.etiket).filter((t) => !usedTags.has(norm(t)))
  return { placements, rooms, matched, unmatched: rest.length, unused }
}
