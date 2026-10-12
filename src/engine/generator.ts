import { EQUIPMENT } from '../library/equipment'
import type { ProjectSettings } from '../model/settings'
import type { ProjectNode, Scenario } from '../model/types'
import { analyze } from './analyze'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, Model, Thresholds } from './types'

/** Dizel yakıt yoğunluğu, g/L. */
const DIESEL_G_PER_L = 840

/** Tipik dizel jeneratör özgül yakıt tüketimi (g/kWh) – yük oranı: [oran, g/kWh]. */
const SFC: [number, number][] = [
  [0.1, 350],
  [0.25, 270],
  [0.5, 230],
  [0.75, 215],
  [1, 210],
]

/** Yük oranına (0..1,1) göre özgül tüketim, doğrusal enterpolasyon. */
export function sfcAt(frac: number): number {
  const f = Math.max(SFC[0][0], Math.min(1, frac))
  for (let i = 0; i < SFC.length - 1; i++) {
    const [x0, y0] = SFC[i]
    const [x1, y1] = SFC[i + 1]
    if (f <= x1) return y0 + ((y1 - y0) * (f - x0)) / (x1 - x0)
  }
  return SFC[SFC.length - 1][1]
}

/** Yakıt tüketimi, L/saat: P·sfc/yoğunluk. Yük oranı jeneratörün nominal aktif gücüne göredir. */
export function fuelLph(ratedKw: number, loadKw: number): number {
  if (loadKw <= 0 || ratedKw <= 0) return 0
  return (loadKw * sfcAt(loadKw / ratedKw)) / DIESEL_G_PER_L
}

const num = (n: ProjectNode, key: string): number => {
  const v = n.params[key] ?? EQUIPMENT[n.type].defaults[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export const ratedKw = (g: ProjectNode): number => num(g, 'nominalKva') * num(g, 'pf')
export const usableFuelL = (g: ProjectNode): number => (num(g, 'yakitL') * num(g, 'yakitKullanilabilir')) / 100

/** Jeneratör özerkliği (saat): kullanılabilir yakıt / tüketim; yüksüzse Infinity. */
export function fuelHours(g: ProjectNode, loadKw: number): number {
  const lph = fuelLph(ratedKw(g), loadKw)
  return lph > 0 ? usableFuelL(g) / lph : Infinity
}

// --- şebeke kaybı çalışması --------------------------------------------------------

export interface GenFuelRow {
  id: string
  name: string
  loadKw: number
  loadingPct: number
  lph: number
  tankL: number
  hours: number
  /** Hedefe göre: 'ok' ≥ hedef, 'warn' ≥ yarısı, 'fail' altı. */
  status: 'ok' | 'warn' | 'fail'
}

export interface StartStep {
  step: number
  delaySec: number
  names: string[]
  steadyKw: number
  steadyKva: number
  /** Bu blokta kalkış akımı dahil görünür güç, kVA. */
  surgeKva: number
  /** Yük alındıktan sonra kümülatif görünür güç, kVA ve jeneratör toplam kapasitesine oranı, %. */
  cumKva: number
  loadPct: number
  /** Jeneratör terminal gerilimi çökmesi, %. */
  dipPct: number
  ok: boolean
}

export interface GeneratorStudy {
  /** Şebekenin tümüyle kaybolduğu durumda jeneratörlerin durumu. */
  gridLoss: Analysis
  rows: GenFuelRow[]
  steps: StartStep[]
  totalKva: number
  /** Jeneratörlerin kısa devre gücü, kVA (Σ Sn/Xd″). */
  scKva: number
  worstDipPct: number
}

/** Bir düğümün yukarısında UPS var mı (UPS arkasındaki yük motor kalkış akımını şebekeye iletmez). */
function behindUps(model: Model, id: string): boolean {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of model.edges) {
      if (e.target !== cur || seen.has(e.source)) continue
      seen.add(e.source)
      const s = byId.get(e.source)
      if (!s) continue
      if (s.type === 'ups') return true
      stack.push(s.id)
    }
  }
  return false
}

/**
 * Şebeke kaybı: jeneratör yakıt özerkliği ve sıralı yük alma. Yükler öncelik gruplarına ayrılır (1 = ilk, UPS girişleri ve
 * kritik yükler); her grup önceki gruptan `yukAlmaAraligi` sn sonra alınır. Gerilim çökmesi ≈ S_kalkış / (S_kalkış + S_kısa devre),
 * S_kalkış = blok yükü (motorlarda kVA × kalkış katı), S_kısa devre = Σ Sn/Xd″ (Xd″ = alt-geçici reaktans alanı; ön tahmin).
 */
export function generatorStudy(model: Model, s: ProjectSettings, th: Thresholds = DEFAULT_THRESHOLDS, scenario?: Scenario): GeneratorStudy {
  const grids = model.nodes.filter((n) => n.type === 'sebeke').map((n) => n.id)
  const sc: Scenario = { id: 'gridloss', ad: 'Şebeke kaybı', failedNodes: [...new Set([...(scenario?.failedNodes ?? []), ...grids])], edgeStates: scenario?.edgeStates ?? {}, nodeStates: scenario?.nodeStates ?? {} }
  const a = analyze(model, th, sc)
  const gens = model.nodes.filter((n) => n.type === 'jenerator' && a.nodes[n.id]?.energized)

  const rows: GenFuelRow[] = gens.map((g) => {
    const r = a.nodes[g.id]
    const hours = fuelHours(g, r.totalKw)
    const target = s.yakitHedefSaat
    return {
      id: g.id,
      name: g.ad,
      loadKw: r.totalKw,
      loadingPct: r.loadingPct ?? 0,
      lph: fuelLph(ratedKw(g), r.totalKw),
      tankL: num(g, 'yakitL'),
      hours,
      status: !Number.isFinite(hours) || hours >= target ? 'ok' : hours >= target / 2 ? 'warn' : 'fail',
    }
  })

  const totalKva = gens.reduce((x, g) => x + num(g, 'nominalKva'), 0)
  const scKva = gens.reduce((x, g) => (num(g, 'xd') > 0 ? x + num(g, 'nominalKva') / (num(g, 'xd') / 100) : x), 0)

  // Yük grupları
  const loads = model.nodes.filter((n) => {
    const d = EQUIPMENT[n.type]
    return d.hasInput && !d.hasOutput && n.type !== 'yardimci' && a.nodes[n.id]?.energized && a.nodes[n.id].totalKw > 0
  })
  type G = { kva: number; kw: number; surge: number; names: string[] }
  const groups = new Map<number, G>()
  const add = (k: number, kva: number, kw: number, surge: number, name: string) => {
    const g = groups.get(k) ?? { kva: 0, kw: 0, surge: 0, names: [] }
    g.kva += kva
    g.kw += kw
    g.surge += surge
    g.names.push(name)
    groups.set(k, g)
  }
  // UPS arkasındaki yükler: UPS girişi (step 1) olarak sayılır; yükün kendisi ayrı sayılmaz.
  for (const u of model.nodes.filter((n) => n.type === 'ups' && a.nodes[n.id]?.energized && !behindUps(model, n.id))) {
    const r = a.nodes[u.id]
    add(1, r.inputKva, r.inputKw, r.inputKva, u.ad)
  }
  for (const l of loads) {
    if (behindUps(model, l.id)) continue
    const r = a.nodes[l.id]
    const onc = Math.min(5, Math.max(1, Math.round(num(l, 'oncelik') || 3)))
    const kat = Math.max(1, num(l, 'kalkisKat') || 1)
    add(onc, r.kva, r.totalKw, r.kva * kat, l.ad)
  }
  const steps: StartStep[] = []
  let cum = 0
  let stepNo = 0
  for (const k of [...groups.keys()].sort((x, y) => x - y)) {
    const g = groups.get(k)!
    stepNo++
    cum += g.kva
    const dip = scKva > 0 ? (g.surge / (g.surge + scKva)) * 100 : 0
    const loadPct = totalKva > 0 ? (cum / totalKva) * 100 : 0
    steps.push({
      step: stepNo,
      delaySec: (k - 1) * s.yukAlmaAraligi,
      names: g.names,
      steadyKw: g.kw,
      steadyKva: g.kva,
      surgeKva: g.surge,
      cumKva: cum,
      loadPct,
      dipPct: dip,
      ok: dip <= s.gerilimCokmesiSiniri && loadPct <= 100,
    })
  }
  return { gridLoss: a, rows, steps, totalKva, scKva, worstDipPct: Math.max(0, ...steps.map((x) => x.dipPct)) }
}
