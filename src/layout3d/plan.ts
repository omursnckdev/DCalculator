import type { Model } from '../engine/types'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, Oda3D, Params, Plan3D, PlanEkipman, ProjectNode, Yerlesim3D } from '../model/types'
import { levels, mountPatches, packZone } from './autoLayout'
import { isMinor } from './dims'
import { roomAt } from './geometry'

/** Plan dışı ekipman için avlu ile bina arası boşluk (m). */
const YARD_GAP = 14
const ZONE_GAP = 5
const ROOM_PAD = 1.5

/** Plandaki nesne şemada yoksa eklenecek düğüm. */
export interface YeniNesne {
  etiket: string
  tur: EquipmentType
  ad: string
  params: Params
  yerlesim: Yerlesim3D
  /** DXF aile (blok) adı: düğüm notuna yazılır. */
  aile?: string
}

export interface PlanResult {
  placements: Record<string, Yerlesim3D>
  /** `ekle` açıksa plandaki eşleşmeyen nesneler için yeni düğümler. */
  yeni: YeniNesne[]
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
export interface ApplyOptions {
  /** Plandaki, şemada karşılığı olmayan nesneleri (türü bilinenleri) yeni düğüm olarak ekle. */
  ekle?: boolean
}

type Wall = [number, number, number, number]

/** Arkası duvara yakın ekipmanın ön yüzü duvarın tersine bakar; yoksa +z (güney). Dönüş ve (g, d) ön yüze göre döndürülür. */
export function facingOf(e: Pick<PlanEkipman, 'x' | 'z' | 'g' | 'd'>, walls: Wall[]): { rot: 0 | 90 | 180 | 270; g: number; d: number } {
  const x0 = e.x - e.g / 2
  const x1 = e.x + e.g / 2
  const z0 = e.z - e.d / 2
  const z1 = e.z + e.d / 2
  let best: { dist: number; back: 'N' | 'S' | 'W' | 'E' } | undefined
  const consider = (dist: number, back: 'N' | 'S' | 'W' | 'E') => {
    if (dist < -0.06 || dist > 0.9) return
    if (!best || dist < best.dist - 1e-6) best = { dist, back }
  }
  for (const [ax, az, bx, bz] of walls) {
    if (Math.abs(az - bz) < 0.06) {
      const ov = Math.min(x1, Math.max(ax, bx)) - Math.max(x0, Math.min(ax, bx))
      if (ov < Math.min(0.4 * e.g, 1.5)) continue
      if (az <= z0 + 0.06) consider(z0 - az, 'N')
      if (az >= z1 - 0.06) consider(az - z1, 'S')
    } else if (Math.abs(ax - bx) < 0.06) {
      const ov = Math.min(z1, Math.max(az, bz)) - Math.max(z0, Math.min(az, bz))
      if (ov < Math.min(0.4 * e.d, 1.5)) continue
      if (ax <= x0 + 0.06) consider(x0 - ax, 'W')
      if (ax >= x1 - 0.06) consider(ax - x1, 'E')
    }
  }
  const back = best?.back
  if (back === 'S') return { rot: 180, g: e.g, d: e.d }
  if (back === 'W') return { rot: 90, g: e.d, d: e.g }
  if (back === 'E') return { rot: 270, g: e.d, d: e.g }
  return { rot: 0, g: e.g, d: e.d }
}

const r2 = (v: number): number => Math.round(v * 1000) / 1000

/** Plan dikdörtgeninden yerleşim: merkez, ön yüze göre dönüş ve boyut, yükseklik. */
function baseLayout(e: PlanEkipman, walls: Wall[], tur?: EquipmentType): Yerlesim3D {
  const f = facingOf(e, walls)
  return {
    x: r2(e.x),
    z: r2(e.z),
    // Yan yana duran dolaplar çizimde milimetre toleransıyla değer; 3 cm küçültme sahte çakışma uyarısını önler
    g: Math.max(0.2, Math.min(40, r2(f.g - 0.03))),
    d: Math.max(0.2, Math.min(40, r2(f.d - 0.03))),
    // Bara (STS bara panosu) dolabın içindeki baralardır: yükseklik tipik kalır (üst üste kotlarda dizilir)
    ...(e.h && tur !== 'bara' ? { y: Math.max(0.2, Math.min(10, e.h)) } : {}),
    ...(f.rot ? { rot: f.rot } : {}),
  }
}

/**
 * Kat planını modele uygular: etiketi eşleşen ana ekipman plandaki dikdörtgenin merkezine ve boyutuna oturur (zemin kat, kot 0;
 * ön yüz arkasındaki duvarın tersine bakar); `ekle` açıkken plandaki ama şemada olmayan nesneler yeni düğüm olarak eklenir
 * (`yeni`). Hiçbir yerde olmayanlar bölgeye göre yerleşir: veri salonu bölgesi (IT, soğutma) plandaki "salon" odasının içine,
 * jeneratör ve dış ekipman binanın doğusundaki avluya, diğer elektrik ekipmanı binanın güneyindeki şeride. Küçük elemanlar
 * (şalter, ölçü) bağlı oldukları ekipmanın ön yüzüne oturur. Sonuç tüm düğümleri kapsar (elle yerleşim korunmaz).
 */
export function applyPlan(model: Model, plan: Plan3D, opts: ApplyOptions = {}): PlanResult {
  const walls = plan.duvarlar
  // Aynı etiket birden çok nesnede geçiyorsa (ör. CCTV, TS, DATA dolapları) genel etikettir: şemadaki düğümle eşleşmez.
  const count = new Map<string, number>()
  for (const e of plan.ekipman) count.set(norm(e.etiket), (count.get(norm(e.etiket)) ?? 0) + 1)
  const byTag = new Map(plan.ekipman.filter((e) => count.get(norm(e.etiket)) === 1).map((e) => [norm(e.etiket), e]))
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
    const base = baseLayout(e, walls, primary.n.type)
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

  // Şemada karşılığı olmayan plan nesneleri → yeni düğüm
  const yeni: YeniNesne[] = []
  if (opts.ekle) {
    const seq = new Map<string, number>()
    const existing = new Set(model.nodes.map((n) => norm(n.ad)))
    for (const e of plan.ekipman) {
      const t = norm(e.etiket)
      if (!e.tur || usedTags.has(t)) continue
      const generic = (count.get(t) ?? 0) > 1
      let ad = e.etiket
      if (generic || existing.has(t)) {
        const k = (seq.get(t) ?? 0) + 1
        seq.set(t, k)
        ad = `${e.etiket} ${k}`
      }
      const d = EQUIPMENT[e.tur]?.defaults
      if (!d) continue
      const params: Params = { ...d, ...(e.p ?? {}) }
      // UPS: kW verilmişse kVA ≈ kW / 0,9
      if (e.tur === 'ups' && e.p?.nominalKw !== undefined && e.p.nominalKva === undefined) params.nominalKva = Math.round(e.p.nominalKw / 0.9)
      yeni.push({ etiket: e.etiket, tur: e.tur, ad, params, yerlesim: baseLayout(e, walls, e.tur), ...(e.aile ? { aile: e.aile } : {}) })
      matched++
    }
  }

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
  for (const y of yeni) {
    const r = roomAt(rooms, y.yerlesim.x, y.yerlesim.z, 0)
    if (r) y.yerlesim.oda = r.id
  }
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

  const addedTags = new Set(yeni.map((y) => norm(y.etiket)))
  const unused = plan.ekipman.map((e) => e.etiket).filter((t) => !usedTags.has(norm(t)) && !addedTags.has(norm(t)))
  return { placements, yeni, rooms, matched, unmatched: rest.length, unused }
}
