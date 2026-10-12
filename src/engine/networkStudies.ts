import { EQUIPMENT } from '../library/equipment'
import type { ProjectEdge, ProjectNode, Scenario } from '../model/types'
import { tr } from '../i18n/tr'
import { switchState } from './switches'
import type { Analysis, Issue, Model, Thresholds } from './types'

/**
 * Şebeke çalışmaları: (1) kaynaktan yüke toplam gerilim düşümü zinciri, (2) üç faz simetrik kısa devre
 * akımı. Her ikisi de tek hat şeması üzerinde basitleştirilmiş (Thevenin) hesaplardır; ön tasarım içindir.
 */

const SQRT3 = Math.sqrt(3)

// --- karmaşık sayı yardımcıları -------------------------------------------------
interface C {
  re: number
  im: number
}
const cAdd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im })
const cAbs = (a: C): number => Math.hypot(a.re, a.im)
const cInv = (a: C): C => {
  const d = a.re * a.re + a.im * a.im
  return { re: a.re / d, im: -a.im / d }
}
/** Paralel bağlı empedanslar. */
const cPar = (list: C[]): C | undefined => {
  if (list.length === 0) return undefined
  let y: C = { re: 0, im: 0 }
  for (const z of list) y = cAdd(y, cInv(z))
  return cInv(y)
}

const num = (n: ProjectNode, key: string): number => {
  const v = n.params[key]
  if (typeof v === 'number') return v
  const d = EQUIPMENT[n.type].defaults[key]
  return typeof d === 'number' ? d : 0
}
const outV = (n: ProjectNode): number => (n.type === 'trafo' ? num(n, 'sekonderGerilim') : n.type === 'ups' ? num(n, 'cikisGerilim') : num(n, 'gerilim'))
const inV = (n: ProjectNode): number => (n.type === 'trafo' ? num(n, 'primerGerilim') : n.type === 'ups' ? num(n, 'girisGerilim') : num(n, 'gerilim'))

const XR_GRID = 10
const XR_GEN = 20

/** Kaynak/trafo/hat empedansları ile her düğümde kısa devre akımı (kA). Yük düğümleri katkı vermez. */
export function shortCircuit(model: Model, scenario?: Scenario): Record<string, number> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const dead = new Set<string>(scenario?.failedNodes ?? [])
  for (const n of model.nodes) if (switchState(n, scenario) === 'acik') dead.add(n.id)
  const edges = model.edges.filter(
    (e) => byId.has(e.source) && byId.has(e.target) && (scenario?.edgeStates[e.id] ?? e.durum) === 'kapali',
  )
  const incoming = new Map<string, ProjectEdge[]>()
  const outgoing = new Map<string, ProjectEdge[]>()
  for (const n of model.nodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    incoming.get(e.target)!.push(e)
    outgoing.get(e.source)!.push(e)
  }
  const indeg = new Map(model.nodes.map((n) => [n.id, incoming.get(n.id)!.length]))
  const order: string[] = []
  const queue = model.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const e of outgoing.get(id)!) {
      const d = indeg.get(e.target)! - 1
      indeg.set(e.target, d)
      if (d === 0) queue.push(e.target)
    }
  }

  // zOut: düğümün çıkış barasına (kendi çıkış geriliminde) bakan Thevenin empedansı.
  const zOut = new Map<string, C | undefined>()
  for (const id of order) {
    const n = byId.get(id)!
    if (dead.has(id)) {
      zOut.set(id, undefined)
      continue
    }
    const def = EQUIPMENT[n.type]
    if (!def.hasInput) {
      const v = outV(n)
      if (n.type === 'sebeke') {
        const mva = num(n, 'kisaDevreMva')
        if (mva > 0 && v > 0) {
          const z = (v * v) / (mva * 1e6)
          const r = z / Math.sqrt(1 + XR_GRID * XR_GRID)
          zOut.set(id, { re: r, im: r * XR_GRID })
        } else zOut.set(id, undefined)
      } else if (n.type === 'jenerator') {
        const sn = num(n, 'nominalKva')
        const xdPct = num(n, 'xd')
        if (sn > 0 && xdPct > 0 && v > 0) {
          const x = (xdPct / 100) * ((v * v) / (sn * 1000))
          const r = x / XR_GEN
          zOut.set(id, { re: r, im: x })
        } else zOut.set(id, undefined)
      } else zOut.set(id, undefined)
      continue
    }
    // Giriş tarafı: gelen hatların (kaynak empedansı + hat empedansı) paralel birleşimi.
    const paths: C[] = []
    for (const e of incoming.get(id)!) {
      const zs = zOut.get(e.source)
      if (!zs) continue
      const lenKm = e.uzunluk / 1000
      paths.push(cAdd(zs, { re: e.r * lenKm, im: e.x * lenKm }))
    }
    const zin = cPar(paths)
    if (n.type === 'trafo') {
      const sn = num(n, 'nominalKva')
      const uk = num(n, 'uk')
      if (!zin || sn <= 0 || uk <= 0) {
        zOut.set(id, undefined)
        continue
      }
      const vs = outV(n)
      const vp = inV(n)
      const k = vp > 0 ? (vs / vp) ** 2 : 1
      const zbase = (vs * vs) / (sn * 1000)
      const zt = (uk / 100) * zbase
      const uR = Math.min(num(n, 'yukKayip') / sn, uk / 100)
      const rt = uR * zbase
      const xt = Math.sqrt(Math.max(0, zt * zt - rt * rt))
      zOut.set(id, cAdd({ re: zin.re * k, im: zin.im * k }, { re: rt, im: xt }))
    } else if (n.type === 'ups') {
      // Evirici akım kaynağı gibi davranır: çıkış kısa devre akımı ≈ k × nominal akım (bypass ayrı yoldan gelir).
      const sn = num(n, 'nominalKva')
      const kati = num(n, 'kisaDevreKati')
      const v = outV(n)
      if (sn > 0 && kati > 0 && v > 0) zOut.set(id, { re: (v * v) / (kati * sn * 1000), im: 0 })
      else zOut.set(id, undefined)
    } else {
      zOut.set(id, zin)
    }
  }

  const out: Record<string, number> = {}
  for (const id of order) {
    const n = byId.get(id)!
    const z = zOut.get(id)
    const v = outV(n)
    if (!z || v <= 0) continue
    out[id] = v / (SQRT3 * cAbs(z)) / 1000
  }
  return out
}

/** Trafo çıkışındaki gerilim düşümü (%): ratio·(uR·cosφ + uX·sinφ). */
function trafoDropPct(n: ProjectNode, a: Analysis): number {
  const r = a.nodes[n.id]
  const sn = num(n, 'nominalKva')
  const uk = num(n, 'uk')
  if (!r || sn <= 0 || uk <= 0 || r.kva <= 0) return 0
  const ratio = r.kva / sn
  const uR = Math.min((num(n, 'yukKayip') / sn) * 100, uk)
  const uX = Math.sqrt(Math.max(0, uk * uk - uR * uR))
  const pf = r.kva > 0 ? Math.min(1, Math.max(0, r.totalKw / r.kva)) : 1
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf))
  return ratio * (uR * pf + uX * sin)
}

/**
 * Sonuçlara toplam gerilim düşümü (kaynaktan o düğüme kadar, canlı yol boyunca en kötü) ve kısa devre
 * akımı yazar; sınır aşımlarını doğrulama listesine ekler. `a` yerinde güncellenir.
 */
export function enrichStudies(model: Model, a: Analysis, th: Thresholds, scenario?: Scenario): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  // 1) Toplam gerilim düşümü: topolojik sıra için canlı hatlar üzerinden yinelemeli.
  const drop = new Map<string, number>()
  const live = model.edges.filter((e) => {
    const r = a.edges[e.id]
    return r && r.live && r.share > 1e-9
  })
  const inEdges = new Map<string, ProjectEdge[]>()
  for (const e of live) {
    const l = inEdges.get(e.target) ?? []
    l.push(e)
    inEdges.set(e.target, l)
  }
  const visiting = new Set<string>()
  const dropOf = (id: string): number => {
    const hit = drop.get(id)
    if (hit !== undefined) return hit
    if (visiting.has(id)) return 0
    visiting.add(id)
    const n = byId.get(id)!
    let best = 0
    for (const e of inEdges.get(id) ?? []) best = Math.max(best, dropOf(e.source) + (a.edges[e.id].voltageDropPct ?? 0))
    const own = n.type === 'trafo' ? trafoDropPct(n, a) : 0
    visiting.delete(id)
    const v = best + own
    drop.set(id, v)
    return v
  }
  for (const n of model.nodes) {
    const r = a.nodes[n.id]
    if (!r || !r.energized || r.cyclic) continue
    r.chainDropPct = dropOf(n.id)
  }

  // 2) Kısa devre akımı.
  const isc = shortCircuit(model, scenario)
  for (const [id, ka] of Object.entries(isc)) if (a.nodes[id]) a.nodes[id].iscKa = ka

  // 3) Doğrulama: yük uçlarında toplam düşüm; kesici kesme kapasitesi.
  const issues: Issue[] = []
  for (const n of model.nodes) {
    const r = a.nodes[n.id]
    if (!r) continue
    if (!EQUIPMENT[n.type].hasOutput && r.chainDropPct !== undefined && r.chainDropPct > th.chainDropPct && r.totalKw > 0) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.chainDrop(n.ad, r.chainDropPct.toFixed(2).replace('.', ','), String(th.chainDropPct)) })
    }
    if (n.type === 'kesici') {
      const rating = num(n, 'kesmeKa')
      const ka = isc[n.id]
      if (rating > 0 && ka !== undefined && ka > rating + 1e-9) {
        issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.breakingCapacity(n.ad, ka.toFixed(1).replace('.', ','), String(rating)) })
      }
    }
  }
  // 4) Soğutma yeterliliği (soğutma kapasitesi tanımlı birim varsa).
  const units = model.nodes
    .filter((n) => n.type === 'mekanikYuk' && num(n, 'sogutmaKw') > 0)
    .map((n) => ({ id: n.id, name: n.ad, kw: num(n, 'sogutmaKw'), energized: !!a.nodes[n.id]?.energized && !a.nodes[n.id]?.failed }))
  if (units.length > 0) {
    const capacityKw = units.reduce((s, u) => s + (u.energized ? u.kw : 0), 0)
    const demandKw = a.heat.salonKw + a.heat.elektrikKw
    const deficitKw = Math.max(0, demandKw - capacityKw)
    a.cooling = { capacityKw, demandKw, deficitKw, reservePct: demandKw > 0 ? ((capacityKw - demandKw) / demandKw) * 100 : undefined, units }
    if (deficitKw > 0.5) {
      issues.push({ severity: 'warning', message: tr.analiz.coolingShort(Math.round(demandKw).toLocaleString('tr-TR'), Math.round(capacityKw).toLocaleString('tr-TR')) })
    }
  }
  a.issues.push(...issues)
}
