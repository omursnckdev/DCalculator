import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { ProjectNode, Scenario } from '../model/types'
import { FULL_AUTOMATION } from './automation'
import type { SimOptions } from './automation'
import { analyze } from './analyze'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, Model, Thresholds } from './types'

/** Tipik cihaz gecikmeleri (saniye). Kararlı durum adımlarının zaman etiketi içindir. */
export const SIM_TIMING = { sts: 0.004, bypass: 0.1, gen: 10, staging: 70 }

export type SimChangeKind =
  | 'fault'
  | 'lost'
  | 'restored'
  | 'deenergized'
  | 'energized'
  | 'transfer'
  | 'autoClose'
  | 'standby'
  | 'genStart'
  | 'battery'
  | 'overload'

export interface SimChange {
  kind: SimChangeKind
  text: string
  nodeId?: string
}

export type SimStageId = 'normal' | 'fault' | 'sts' | 'bypass' | 'gen' | 'staging' | 'battery'

export interface SimStep {
  id: SimStageId
  title: string
  description: string
  seconds: number
  timeLabel: string
  analysis: Analysis
  changes: SimChange[]
  /** Bu adımda durumu değişen ekipman (arayüzde vurgulanır). */
  changedNodes: string[]
  lostKw: number
}

const fmt = (v: number, d = 0): string => v.toLocaleString('tr-TR', { maximumFractionDigits: d })
const major = (n: ProjectNode) => n.type !== 'kesici' && n.type !== 'yardimci'
const isLoad = (n: ProjectNode) => !EQUIPMENT[n.type].hasOutput && n.type !== 'yardimci'
const list = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} … (+${names.length - 6})` : names.join(', '))

function timeLabel(s: number): string {
  if (s === 0) return tr.sim.t0
  if (s < 1) return tr.sim.ms(Math.round(s * 1000))
  if (s < 60) return tr.sim.sec(Math.round(s))
  return tr.sim.min(Math.round(s / 60))
}

/** Transfer anahtarının (ATS/STS) o an aktif girişi. */
function activeInput(a: Analysis, model: Model, nodeId: string): { port: number; name: string } | undefined {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  // Kesici/bara/ölçü elemanlarını geçip gerçek kaynağı (pano, UPS, trafo, şebeke...) adlandır.
  const origin = (id: string): string => {
    let cur = byId.get(id)
    for (let guard = 0; cur && guard < 20; guard++) {
      if (cur.type !== 'kesici' && cur.type !== 'bara' && cur.type !== 'yardimci') return cur.ad
      const ups = model.edges.filter((x) => x.target === cur!.id)
      if (ups.length !== 1) return cur.ad
      cur = byId.get(ups[0].source)
    }
    return id
  }
  let best: { port: number; name: string; share: number } | undefined
  for (const e of model.edges) {
    if (e.target !== nodeId) continue
    const r = a.edges[e.id]
    if (!r || !r.live || r.share <= 1e-9) continue
    if (!best || r.share > best.share) best = { port: e.hedefPort, name: origin(e.source), share: r.share }
  }
  return best
}

/**
 * Anlamlı durum imzası: yük/güç akışı ve durum bayrakları. Yalnızca "enerjili ama boşta" olan
 * ekipman (ör. çalışıp yük almayan jeneratör ve kolları) imzayı değiştirmez; yükler için enerji durumu sayılır.
 */
function signature(a: Analysis, model: Model): string {
  const loads = new Set(model.nodes.filter(isLoad).map((n) => n.id))
  const parts: string[] = []
  for (const [id, r] of Object.entries(a.nodes)) {
    parts.push(`${id}:${loads.has(id) && r.energized ? 1 : 0}${r.open ? 1 : 0}${r.autoClosed ? 1 : 0}${r.standby ? 1 : 0}${r.onBattery ? 1 : 0}:${Math.round(r.totalKw)}`)
  }
  // Boştaki kolların pay değişimi sayılmaz: yalnızca güç taşıyan hatlar.
  for (const [id, r] of Object.entries(a.edges)) if (r.kva > 0.5) parts.push(`${id}:${Math.round(r.kva)}:${Math.round(r.share * 100)}`)
  return parts.join('|')
}

/** İki ardışık durum arasındaki değişikliklerin insan okunur günlüğü. */
export function diffAnalyses(
  model: Model,
  prev: Analysis | undefined,
  cur: Analysis,
  faultNames: string[] = [],
  reference?: Analysis,
): { changes: SimChange[]; changedNodes: string[] } {
  const changes: SimChange[] = []
  const changed = new Set<string>()
  if (faultNames.length) for (const n of faultNames) changes.push({ kind: 'fault', text: tr.sim.changeFault(n) })
  if (!prev) return { changes, changedNodes: [] }

  const lost: string[] = []
  const back: string[] = []
  const off: string[] = []
  const on: string[] = []
  for (const n of model.nodes) {
    const p = prev.nodes[n.id]
    const c = cur.nodes[n.id]
    if (!p || !c) continue
    // Güç taşımayan (boşta) ekipmanın yalnızca "enerjili/enerjisiz" geçişi anlamlı değildir (ör. çalışıp
    // yük almayan jeneratör ve kolları); yükler ve güç taşıyanlar için sayılır.
    const carried = p.totalKw > 0.5 || c.totalKw > 0.5 || isLoad(n)
    const stateChanged =
      (carried && p.energized !== c.energized) || p.open !== c.open || p.autoClosed !== c.autoClosed || p.standby !== c.standby || p.onBattery !== c.onBattery
    if (stateChanged || (c.loadingPct !== undefined && p.loadingPct !== undefined && Math.abs(c.loadingPct - p.loadingPct) > 2)) {
      changed.add(n.id)
    }
    if (c.failed && !p.failed) changed.add(n.id)
    if (carried && p.energized && !c.energized && !c.failed && !c.open && major(n)) (isLoad(n) ? lost : off).push(n.ad)
    if (carried && !p.energized && c.energized && major(n)) (isLoad(n) ? back : on).push(n.ad)
    if (c.autoClosed && !p.autoClosed) changes.push({ kind: 'autoClose', text: tr.sim.autoClosed(n.ad), nodeId: n.id })
    if (c.standby && !p.standby) changes.push({ kind: 'standby', text: tr.sim.standbyOn(n.ad), nodeId: n.id })
    if (!c.standby && p.standby) changes.push({ kind: 'standby', text: tr.sim.standbyOff(n.ad), nodeId: n.id })
    if (c.onBattery && !p.onBattery) changes.push({ kind: 'battery', text: tr.sim.batteryOn(n.ad), nodeId: n.id })
    if (!c.onBattery && p.onBattery && c.energized) changes.push({ kind: 'battery', text: tr.sim.batteryOff(n.ad), nodeId: n.id })
    if (n.type === 'jenerator' && c.totalKw > 0.5 && p.totalKw <= 0.5) {
      changes.push({ kind: 'genStart', text: tr.sim.genStart(n.ad, fmt(c.totalKw), fmt(c.loadingPct ?? 0)), nodeId: n.id })
    }
    if (c.status === 'over' && p.status !== 'over' && c.loadingPct !== undefined) {
      changes.push({ kind: 'overload', text: tr.sim.overloaded(n.ad, fmt(c.loadingPct)), nodeId: n.id })
    }
    if ((n.type === 'ats' || n.type === 'sts') && c.energized) {
      // Önceki adımda anahtar enerjisizdiyse (kilitli kaynak ölü) geçişi arıza öncesi aktif girişe göre anlat.
      const a0 = activeInput(prev, model, n.id) ?? (reference ? activeInput(reference, model, n.id) : undefined)
      const a1 = activeInput(cur, model, n.id)
      if (a0 && a1 && a0.port !== a1.port) {
        changes.push({ kind: 'transfer', text: tr.sim.transfer(n.ad, `${a0.name} (G${a0.port + 1})`, `${a1.name} (G${a1.port + 1})`), nodeId: n.id })
        changed.add(n.id)
      }
    }
  }
  const lostKw = cur.unserved.totalKw - prev.unserved.totalKw
  const at = faultNames.length // arıza satırları hep en üstte
  if (lostKw > 0.5) changes.splice(at, 0, { kind: 'lost', text: tr.sim.lostLoad(fmt(lostKw), list(lost)) })
  else if (lostKw < -0.5) changes.splice(at, 0, { kind: 'restored', text: tr.sim.restoredLoad(fmt(-lostKw), list(back)) })
  if (off.length) changes.push({ kind: 'deenergized', text: tr.sim.deenergized(list(off)) })
  if (on.length) changes.push({ kind: 'energized', text: tr.sim.energizedAgain(list(on)) })
  return { changes, changedNodes: [...changed] }
}

/**
 * Seçilen ekipman(lar)ın arızasını aşama aşama çözer: arıza anı, STS transferi, otomatik bypass,
 * jeneratörlerin devreye girmesi, jeneratör yük sıralaması ve batarya bitişi. Her aşama, o ana kadar
 * devreye girmiş otomasyonlarla kararlı durum çözümüdür; değişmeyen aşamalar atlanır.
 */
export function simulateFailure(
  model: Model,
  failedIds: string[],
  baseScenario?: Scenario,
  th: Thresholds = DEFAULT_THRESHOLDS,
): SimStep[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const faultNames = failedIds.map((id) => byId.get(id)?.ad ?? id)
  const scenario: Scenario = {
    id: 'sim',
    ad: 'sim',
    failedNodes: [...new Set([...(baseScenario?.failedNodes ?? []), ...failedIds])],
    edgeStates: baseScenario?.edgeStates ?? {},
    nodeStates: baseScenario?.nodeStates ?? {},
  }
  const base = analyze(model, th, baseScenario)
  const run = (opts: Partial<SimOptions>) => analyze(model, th, scenario, base, opts)

  // Arıza anında transfer anahtarları son seçili girişlerini korur.
  const hold: Record<string, string> = {}
  for (const n of model.nodes) {
    if (n.type !== 'ats' && n.type !== 'sts') continue
    let bestId: string | undefined
    let bestShare = 1e-9
    for (const e of model.edges) {
      const r = base.edges[e.id]
      if (e.target === n.id && r && r.live && r.share > bestShare) {
        bestShare = r.share
        bestId = e.id
      }
    }
    if (bestId) hold[n.id] = bestId
  }

  const autonomyMin = Math.max(
    1,
    ...model.nodes.filter((n) => n.type === 'ups').map((n) => (typeof n.params.bataryaDk === 'number' ? n.params.bataryaDk : 10)),
  )
  const stages: { id: SimStageId; seconds: number; opts: Partial<SimOptions> }[] = [
    { id: 'fault', seconds: 0, opts: { autoBypass: false, staging: false, genOnline: false, battery: true, hold } },
    { id: 'sts', seconds: SIM_TIMING.sts, opts: { autoBypass: false, staging: false, genOnline: false, battery: true } },
    { id: 'bypass', seconds: SIM_TIMING.bypass, opts: { autoBypass: true, staging: false, genOnline: false, battery: true } },
    { id: 'gen', seconds: SIM_TIMING.gen, opts: { autoBypass: true, staging: false, genOnline: true, battery: true } },
    { id: 'staging', seconds: SIM_TIMING.staging, opts: { autoBypass: true, staging: true, genOnline: true, battery: true } },
    { id: 'battery', seconds: autonomyMin * 60, opts: { ...FULL_AUTOMATION } },
  ]

  const steps: SimStep[] = []
  const push = (id: SimStageId, seconds: number, analysis: Analysis, prev?: Analysis, faults: string[] = []) => {
    const { changes, changedNodes } = diffAnalyses(model, prev, analysis, faults, base)
    steps.push({
      id,
      title: tr.sim.stages[id],
      description: tr.sim.stageDesc[id],
      seconds,
      timeLabel: timeLabel(seconds),
      analysis,
      changes,
      changedNodes: [...new Set([...changedNodes, ...(id === 'fault' ? failedIds : [])])],
      lostKw: Math.max(0, analysis.unserved.totalKw - base.unserved.totalKw),
    })
  }
  push('normal', -1, base)
  steps[0].timeLabel = ''
  let prev = base
  let prevSig = signature(base, model)
  for (const st of stages) {
    const a = run(st.opts)
    const sig = signature(a, model)
    if (st.id !== 'fault' && sig === prevSig) continue
    push(st.id, st.seconds, a, prev, st.id === 'fault' ? faultNames : [])
    prev = a
    prevSig = sig
  }
  return steps
}
