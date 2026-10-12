import { EQUIPMENT } from '../library/equipment'
import { GEN_START_FAILURE_PCT, TIERS } from '../library/reliability'
import type { ProjectSettings } from '../model/settings'
import type { Model } from './types'

/** Yılda saat sayısı. */
const HOURS_PER_YEAR = 8760

export interface CutSet {
  /** Eşzamanlı arıza sayısı (1, 2 veya 3). */
  order: 1 | 2 | 3
  ids: string[]
  names: string[]
  /** Kesit kümesinin kararsız kalma olasılığı (bileşen kullanılamazlıklarının çarpımı). */
  probability: number
  /** Sistem kullanılamazlığındaki payı, %. */
  share: number
  /** Bu kümede kesintiye uğrayan IT yükleri. */
  loads: string[]
}

export interface ReliabilityReport {
  availability: number
  unavailability: number
  /** Yıllık beklenen kesinti, dakika. */
  downtimeMinPerYear: number
  /** Kaç dokuz: −log10(kullanılamazlık). */
  nines: number
  /** Sağlanan en yüksek Tier kıyası (erişilebilirlik bakımından); yoksa undefined. */
  tier?: string
  cutSets: CutSet[]
  /** Derece başına kesit kümesi sayısı. */
  counts: { single: number; pair: number; triple: number }
  /** Üçlü kombinasyonlar atlandı (bileşen sayısı çok). */
  truncated: boolean
  components: number
  /** IT yükü başına erişilebilirlik. */
  perLoad: { id: string; name: string; availability: number; downtimeMinPerYear: number }[]
}

interface Comp {
  id: string
  kind: 'node' | 'edge'
  name: string
  u: number
}

const unavail = (mtbf: number, mttr: number): number => (mtbf + mttr > 0 ? mttr / (mtbf + mttr) : 0)

const pnum = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Bileşen listesi: güç zincirindeki ekipman (yük ve ölçü elemanı hariç) ve kapalı hatlar. */
function components(model: Model, s: ProjectSettings): Comp[] {
  const out: Comp[] = []
  for (const n of model.nodes) {
    const def = EQUIPMENT[n.type]
    if (!def.hasOutput && def.hasInput) continue // yük
    if (n.type === 'yardimci') continue
    const mtbf = pnum(n.params.mtbf, pnum(def.defaults.mtbf, 0))
    const mttr = pnum(n.params.mttr, pnum(def.defaults.mttr, 0))
    if (mtbf <= 0) continue
    let u = unavail(mtbf, mttr)
    if (n.type === 'jenerator') u = Math.min(1, u + pnum(n.params.baslamaHata, GEN_START_FAILURE_PCT) / 100)
    out.push({ id: n.id, kind: 'node', name: n.ad, u })
  }
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  for (const e of model.edges) {
    if (e.durum !== 'kapali') continue
    const bus = e.tip === 'busbar'
    out.push({
      id: e.id,
      kind: 'edge',
      name: `${byId.get(e.source)?.ad ?? e.source} → ${byId.get(e.target)?.ad ?? e.target}`,
      u: unavail(bus ? s.busbarMtbf : s.kabloMtbf, bus ? s.busbarMttr : s.kabloMttr),
    })
  }
  return out
}

/**
 * Hızlı bağlantı değerlendiricisi: tamsayı indeksli yönlü çizgede, arızalı bileşenler çıkarılarak kaynaklardan (şebeke,
 * jeneratör) yayılım. Otomatik kapanan bypass kesicileri kapalı sayılır (UPS sağlamken fazlalık, arızalıyken yedek yol).
 */
function buildEvaluator(model: Model) {
  const idx = new Map(model.nodes.map((n, i) => [n.id, i]))
  const N = model.nodes.length
  const adjTo: number[][] = Array.from({ length: N }, () => [])
  const adjEdge: number[][] = Array.from({ length: N }, () => [])
  const edgeList = model.edges.map((e, i) => ({ e, i }))
  const edgeIdx = new Map(model.edges.map((e, i) => [e.id, i]))
  const baseDead = new Uint8Array(N)
  const hasInput = new Uint8Array(N)
  model.nodes.forEach((n, i) => {
    hasInput[i] = EQUIPMENT[n.type].hasInput ? 1 : 0
    const auto = n.type === 'kesici' && n.params.otomatik === 'otomatik'
    if (n.type === 'kesici' && n.params.durum === 'acik' && !auto) baseDead[i] = 1 // normalde açık ayırıcı/kuplaj
  })
  const edgeOpen = new Uint8Array(model.edges.length)
  for (const { e, i } of edgeList) {
    const s = idx.get(e.source)
    const t = idx.get(e.target)
    if (s === undefined || t === undefined) continue
    if (e.durum !== 'kapali') {
      edgeOpen[i] = 1
      continue
    }
    adjTo[s].push(t)
    adjEdge[s].push(i)
  }
  const sources: number[] = []
  model.nodes.forEach((n, i) => {
    if (!EQUIPMENT[n.type].hasInput) sources.push(i)
  })
  const itLoads: number[] = []
  model.nodes.forEach((n, i) => {
    const def = EQUIPMENT[n.type]
    if (def.hasInput && !def.hasOutput && n.type !== 'yardimci' && (n.params.kategori ?? def.defaults.kategori) === 'IT') itLoads.push(i)
  })
  const seen = new Uint8Array(N)
  const stack = new Int32Array(N + 4)
  /** Arızalı düğüm/hat kümesiyle enerjili kalmayan IT yüklerinin indeksleri. */
  const lost = (failNodes: number[], failEdges: number[]): number[] => {
    seen.fill(0)
    const dead = new Uint8Array(baseDead)
    for (const i of failNodes) dead[i] = 1
    const eDead = new Uint8Array(edgeOpen)
    for (const i of failEdges) eDead[i] = 1
    let sp = 0
    for (const s of sources) {
      if (!dead[s]) {
        seen[s] = 1
        stack[sp++] = s
      }
    }
    while (sp > 0) {
      const u = stack[--sp]
      const to = adjTo[u]
      const ed = adjEdge[u]
      for (let k = 0; k < to.length; k++) {
        const v = to[k]
        if (seen[v] || dead[v] || eDead[ed[k]]) continue
        seen[v] = 1
        stack[sp++] = v
      }
    }
    const out: number[] = []
    for (const l of itLoads) if (!seen[l]) out.push(l)
    return out
  }
  return { idx, edgeIdx, itLoads, lost, N }
}

/** Üçlü kombinasyon taramasının üst sınırı (bileşen sayısı). */
const TRIPLE_LIMIT = 40

/**
 * Güç zinciri erişilebilirliği: IT yüklerinden herhangi birinin enerjisiz kalması kesinti sayılır. Bileşenler bağımsız
 * arıza/onarım süreçleri (kullanılamazlık U = MTTR/(MTBF+MTTR)) olarak alınır; asgari kesit kümeleri (1., 2. ve küçük
 * sistemlerde 3. derece) bulunur, sistem kullanılamazlığı ≈ Σ Π U (nadir olay yaklaşımı). UPS bataryası kısa
 * kesintileri tolere etse de burada sayılmaz (muhafazakâr: yalnız bağlantı).
 */
export function reliabilityReport(model: Model, s: ProjectSettings): ReliabilityReport {
  const comps = components(model, s)
  const ev = buildEvaluator(model)
  const nodeIdx = (c: Comp): number | undefined => (c.kind === 'node' ? ev.idx.get(c.id) : undefined)
  const edgeIdxOf = (c: Comp): number | undefined => (c.kind === 'edge' ? ev.edgeIdx.get(c.id) : undefined)
  const fail = (cs: Comp[]) => {
    const ns: number[] = []
    const es: number[] = []
    for (const c of cs) {
      const a = nodeIdx(c)
      if (a !== undefined) ns.push(a)
      const b = edgeIdxOf(c)
      if (b !== undefined) es.push(b)
    }
    return ev.lost(ns, es)
  }
  const nameOfLoad = (i: number): string => model.nodes[i].ad

  const raw: { cs: Comp[]; lostLoads: number[] }[] = []
  const singles = new Set<number>()
  comps.forEach((c, i) => {
    const l = fail([c])
    if (l.length > 0) {
      singles.add(i)
      raw.push({ cs: [c], lostLoads: l })
    }
  })
  const pairs = new Set<string>()
  const rest = comps.map((_, i) => i).filter((i) => !singles.has(i))
  for (let a = 0; a < rest.length; a++) {
    for (let b = a + 1; b < rest.length; b++) {
      const l = fail([comps[rest[a]], comps[rest[b]]])
      if (l.length > 0) {
        pairs.add(`${rest[a]},${rest[b]}`)
        raw.push({ cs: [comps[rest[a]], comps[rest[b]]], lostLoads: l })
      }
    }
  }
  let truncated = false
  if (rest.length <= TRIPLE_LIMIT) {
    for (let a = 0; a < rest.length; a++) {
      for (let b = a + 1; b < rest.length; b++) {
        if (pairs.has(`${rest[a]},${rest[b]}`)) continue
        for (let c = b + 1; c < rest.length; c++) {
          if (pairs.has(`${rest[a]},${rest[c]}`) || pairs.has(`${rest[b]},${rest[c]}`)) continue
          const l = fail([comps[rest[a]], comps[rest[b]], comps[rest[c]]])
          if (l.length > 0) raw.push({ cs: [comps[rest[a]], comps[rest[b]], comps[rest[c]]], lostLoads: l })
        }
      }
    }
  } else truncated = true

  const prob = (cs: Comp[]): number => cs.reduce((p, c) => p * c.u, 1)
  const unavailability = Math.min(1, raw.reduce((x, r) => x + prob(r.cs), 0))
  const perLoadU = new Map<number, number>()
  for (const r of raw) for (const l of r.lostLoads) perLoadU.set(l, (perLoadU.get(l) ?? 0) + prob(r.cs))

  const cutSets: CutSet[] = raw
    .map((r) => ({
      order: r.cs.length as 1 | 2 | 3,
      ids: r.cs.map((c) => c.id),
      names: r.cs.map((c) => c.name),
      probability: prob(r.cs),
      share: unavailability > 0 ? (prob(r.cs) / unavailability) * 100 : 0,
      loads: r.lostLoads.map(nameOfLoad),
    }))
    .sort((a, b) => b.probability - a.probability)

  const availability = 1 - unavailability
  const downtimeMinPerYear = unavailability * HOURS_PER_YEAR * 60
  const tier = [...TIERS].reverse().find((t) => availability * 100 >= t.availabilityPct)?.name
  return {
    availability,
    unavailability,
    downtimeMinPerYear,
    nines: unavailability > 0 ? -Math.log10(unavailability) : Infinity,
    tier,
    cutSets: cutSets.slice(0, 40),
    counts: { single: cutSets.filter((c) => c.order === 1).length, pair: cutSets.filter((c) => c.order === 2).length, triple: cutSets.filter((c) => c.order === 3).length },
    truncated,
    components: comps.length,
    perLoad: ev.itLoads.map((l) => ({
      id: model.nodes[l].id,
      name: model.nodes[l].ad,
      availability: 1 - Math.min(1, perLoadU.get(l) ?? 0),
      downtimeMinPerYear: Math.min(1, perLoadU.get(l) ?? 0) * HOURS_PER_YEAR * 60,
    })),
  }
}
