import type { EdgeState, Scenario } from '../model/types'
import { EQUIPMENT } from '../library/equipment'
import { analyze } from './analyze'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, Model, Thresholds } from './types'

/** En kritik doluluk bilgisi: ekipman veya hat adı ve yüzdesi. */
export interface PeakLoading {
  name: string
  pct: number
}

export interface N1Row {
  kind: 'node' | 'edge'
  id: string
  /** Gösterim adı (ekipman adı ya da "A → B"). */
  label: string
  /** Bu arıza yüzünden (temel duruma göre) kaybedilen yük, kW. */
  lostItKw: number
  lostMechKw: number
  /** Kalan ekipman ve hatlar içinde en yüksek doluluk. */
  peak?: PeakLoading
  /** %100'ü aşan ekipman/hatlar. */
  overloads: PeakLoading[]
  /** Yük kaybı yok ve aşırı yüklenen ekipman yok. */
  ok: boolean
}

/** Senaryo analizindeki ekipman/hat doluluk özetini çıkarır. */
export function loadingSummary(a: Analysis, model: Model, th: Thresholds): { peak?: PeakLoading; overloads: PeakLoading[] } {
  const items: PeakLoading[] = []
  const nameOf = new Map(model.nodes.map((n) => [n.id, n.ad]))
  for (const n of model.nodes) {
    const r = a.nodes[n.id]
    if (r && r.energized && r.loadingPct !== undefined) items.push({ name: n.ad, pct: r.loadingPct })
  }
  for (const e of model.edges) {
    const r = a.edges[e.id]
    if (r && r.live && r.loadingPct !== undefined) {
      items.push({ name: `${nameOf.get(e.source)} → ${nameOf.get(e.target)}`, pct: r.loadingPct })
    }
  }
  items.sort((x, y) => y.pct - x.pct)
  return { peak: items[0], overloads: items.filter((i) => i.pct > th.overPct) }
}

/**
 * Otomatik N-1: her yük-dışı ekipman ve her kapalı hat için tek tek "arızalı" kabul edilip
 * (anahtar durumları temel durumda bırakılarak, yani operatör müdahalesi olmadan) kalan
 * şemanın yükü hesaplanır. Sonuç, arıza başına kaybedilen yük ve en yüksek doluluk.
 */
export function runN1(model: Model, th: Thresholds = DEFAULT_THRESHOLDS): N1Row[] {
  const base = analyze(model, th)
  const rows: N1Row[] = []
  const nameOf = new Map(model.nodes.map((n) => [n.id, n.ad]))

  const build = (kind: 'node' | 'edge', id: string, label: string, scenario: Scenario): N1Row => {
    const a = analyze(model, th, scenario, base)
    const { peak, overloads } = loadingSummary(a, model, th)
    const lostIt = Math.max(0, a.unserved.itKw - base.unserved.itKw)
    const lostMech = Math.max(0, a.unserved.mechKw - base.unserved.mechKw)
    return {
      kind,
      id,
      label,
      lostItKw: lostIt,
      lostMechKw: lostMech,
      peak,
      overloads,
      ok: lostIt + lostMech < 1e-9 && overloads.length === 0,
    }
  }

  for (const n of model.nodes) {
    if (!EQUIPMENT[n.type].hasOutput) continue // yükler "arıza"ya aday değil
    rows.push(build('node', n.id, n.ad, { id: `n1-${n.id}`, ad: n.ad, failedNodes: [n.id], edgeStates: {}, nodeStates: {} }))
  }
  for (const e of model.edges) {
    if (e.durum !== 'kapali') continue
    const state: Record<string, EdgeState> = { [e.id]: 'acik' }
    const label = `${nameOf.get(e.source) ?? e.source} → ${nameOf.get(e.target) ?? e.target}`
    rows.push(build('edge', e.id, label, { id: `n1-${e.id}`, ad: label, failedNodes: [], edgeStates: state, nodeStates: {} }))
  }
  return rows
}
