import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { ProjectNode, Scenario } from '../model/types'
import { FULL_AUTOMATION } from './automation'
import type { SimOptions } from './automation'
import { analyze } from './analyze'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, Model, Thresholds } from './types'

/** Tipik cihaz gecikmeleri (saniye). Kararlı durum adımlarının zaman etiketi içindir. */
export const SIM_TIMING = {
  sts: 0.004,
  bypass: 0.1,
  gen: 10,
  staging: 70,
  /** Normal kaynak döndükten sonra ATS/STS geri transfer gecikmesi (tipik 5 dk). */
  retransfer: 300,
  /** Jeneratör yüksüz soğutma süresi (tipik 5 dk). */
  cooldown: 300,
}

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
  | 'cleared'
  | 'genStop'

export interface SimChange {
  kind: SimChangeKind
  text: string
  nodeId?: string
}

export type SimStageId = 'normal' | 'fault' | 'sts' | 'bypass' | 'gen' | 'staging' | 'battery' | 'clear' | 'retransfer' | 'genStop'

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
  /** 'recovery': arıza giderildikten sonraki adımlar. */
  phase: 'fault' | 'recovery'
  /** Bu adımı üreten otomasyon durumu; arızanın bu adımdan giderilmesi için kullanılır. */
  opts: Partial<SimOptions>
  /** Çalışan (yüksüz de olsa) jeneratör kimlikleri. */
  running: string[]
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
    parts.push(`${id}:${loads.has(id) && r.energized ? 1 : 0}${r.open ? 1 : 0}${r.autoClosed ? 1 : 0}${r.standby ? 1 : 0}${r.onBattery ? 1 : 0}${r.running ? 1 : 0}:${Math.round(r.totalKw)}`)
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
    if (n.type === 'jenerator' && p.running && !c.running && !c.standby) {
      changes.push({ kind: 'genStop', text: tr.sim.genStopped(n.ad), nodeId: n.id })
      changed.add(n.id)
    } else if (n.type === 'jenerator' && c.running && p.totalKw > 0.5 && c.totalKw <= 0.5) {
      changes.push({ kind: 'genStop', text: tr.sim.genUnloaded(n.ad), nodeId: n.id })
      changed.add(n.id)
    }
    if (n.type === 'jenerator' && c.totalKw > 0.5 && p.totalKw <= 0.5) {
      changes.push({ kind: 'genStart', text: tr.sim.genStart(n.ad, fmt(c.totalKw), fmt(c.loadingPct ?? 0)), nodeId: n.id })
    }
    if (c.status === 'over' && p.status !== 'over' && c.loadingPct !== undefined) {
      changes.push({ kind: 'overload', text: tr.sim.overloaded(n.ad, fmt(c.loadingPct)), nodeId: n.id })
    }
    // Tek aktif girişli çok girişli pano (ör. MSB'de trafo ↔ jeneratör): giriş değişimi de bir transferdir.
    const singleFed = (x: Analysis) => model.edges.filter((e) => e.target === n.id && (x.edges[e.id]?.share ?? 0) > 1e-9 && x.edges[e.id]?.live).length === 1
    const multiIn = model.edges.filter((e) => e.target === n.id).length >= 2
    if (((n.type === 'ats' || n.type === 'sts') || (multiIn && (n.type === 'mdb' || n.type === 'dagitimPanosu') && singleFed(prev) && singleFed(cur))) && c.energized) {
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

/** Transfer anahtarlarının (ATS/STS) o anki aktif giriş hattı: arıza anında/arıza sonrasında korunur. */
function holdFrom(a: Analysis, model: Model, genPanels = false): Record<string, string> {
  const hold: Record<string, string> = {}
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  // Düğümün tüm kaynak uçları (girişi olmayan) jeneratör mü? (yalnız jeneratörle beslenen kol)
  const memo = new Map<string, boolean>()
  const genOnly = (id: string, depth = 0): boolean => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const n = byId.get(id)
    const ins = model.edges.filter((e) => e.target === id)
    const v = !n || depth > 40 ? false : ins.length === 0 ? n.type === 'jenerator' : ins.every((e) => genOnly(e.source, depth + 1))
    memo.set(id, v)
    return v
  }
  for (const n of model.nodes) {
    const transfer = n.type === 'ats' || n.type === 'sts'
    if (!transfer) {
      // Arıza giderme: jeneratör kolundan beslenen, ayrıca normal kaynak kolu da olan pano (ör. MSB).
      if (!genPanels) continue
      const ins = model.edges.filter((e) => e.target === n.id)
      if (ins.length < 2 || !ins.some((e) => !genOnly(e.source)) || !ins.some((e) => genOnly(e.source))) continue
    }
    let bestId: string | undefined
    let bestShare = 1e-9
    for (const e of model.edges) {
      const r = a.edges[e.id]
      if (e.target === n.id && r && r.live && r.share > bestShare) {
        bestShare = r.share
        bestId = e.id
      }
    }
    const bestEdge = model.edges.find((e) => e.id === bestId)
    if (bestId && (transfer || (bestEdge && genOnly(bestEdge.source)))) hold[n.id] = bestId
  }
  return hold
}

/** Çalışan jeneratörleri işaretler (rozet ve değişiklik günlüğü için). */
function markRunning(a: Analysis, ids: string[]): void {
  for (const id of ids) if (a.nodes[id]) a.nodes[id] = { ...a.nodes[id], running: true }
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

  const hold = holdFrom(base, model)

  const autonomyMin = Math.max(
    1,
    ...model.nodes.filter((n) => n.type === 'ups').map((n) => (typeof n.params.bataryaDk === 'number' ? n.params.bataryaDk : 10)),
  )
  const stages: { id: SimStageId; seconds: number; opts: Partial<SimOptions>; gens: boolean }[] = [
    { id: 'fault', seconds: 0, opts: { autoBypass: false, staging: false, genOnline: false, battery: true, hold }, gens: false },
    { id: 'sts', seconds: SIM_TIMING.sts, opts: { autoBypass: false, staging: false, genOnline: false, battery: true }, gens: false },
    { id: 'bypass', seconds: SIM_TIMING.bypass, opts: { autoBypass: true, staging: false, genOnline: false, battery: true }, gens: false },
    { id: 'gen', seconds: SIM_TIMING.gen, opts: { autoBypass: true, staging: false, genOnline: true, battery: true }, gens: true },
    { id: 'staging', seconds: SIM_TIMING.staging, opts: { autoBypass: true, staging: true, genOnline: true, battery: true }, gens: true },
    { id: 'battery', seconds: autonomyMin * 60, opts: { ...FULL_AUTOMATION }, gens: true },
  ]

  const steps: SimStep[] = []
  const push = (id: SimStageId, seconds: number, analysis: Analysis, opts: Partial<SimOptions>, prev?: Analysis, faults: string[] = []) => {
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
      phase: 'fault',
      opts,
      running: runningGens(analysis),
    })
  }
  push('normal', -1, base, { ...FULL_AUTOMATION })
  steps[0].timeLabel = ''
  let prev = base
  let prevSig = signature(base, model)
  for (const st of stages) {
    const a = run(st.opts)
    // Jeneratör yalnızca yük taşıyorsa (normal kaynak kayıpken) çalıştırılmıştır.
    if (st.gens) markRunning(a, model.nodes.filter((n) => n.type === 'jenerator' && a.nodes[n.id]?.totalKw > 0.5).map((n) => n.id))
    const sig = signature(a, model)
    if (st.id !== 'fault' && sig === prevSig) continue
    push(st.id, st.seconds, a, st.opts, prev, st.id === 'fault' ? faultNames : [])
    prev = a
    prevSig = sig
  }
  return steps
}

const runningGens = (a: Analysis): string[] => Object.values(a.nodes).filter((r) => r.running).map((r) => r.id)

/**
 * Arızanın `from` adımından itibaren giderilmesini çözer: arıza giderildi (transferler ve bypass henüz
 * eski konumda, jeneratörler yükte), normal kaynağa geri transfer (bypass geri açılır, jeneratör yüksüz
 * çalışır), jeneratör soğutma sonrası durur. Dönen adımlar `from`dan sonra eklenir.
 */
export function simulateRecovery(
  model: Model,
  failedIds: string[],
  from: SimStep,
  baseScenario?: Scenario,
  th: Thresholds = DEFAULT_THRESHOLDS,
): SimStep[] {
  const base = analyze(model, th, baseScenario)
  const names = failedIds.map((id) => model.nodes.find((n) => n.id === id)?.ad ?? id)
  const keepClosed = model.nodes.filter((n) => from.analysis.nodes[n.id]?.autoClosed).map((n) => n.id)
  const stages: { id: SimStageId; seconds: number; opts: Partial<SimOptions>; running: string[] }[] = [
    { id: 'clear', seconds: 0, opts: { ...from.opts, hold: holdFrom(from.analysis, model, true), keepClosed }, running: from.running },
    {
      id: 'retransfer',
      seconds: SIM_TIMING.retransfer,
      opts: { autoBypass: true, staging: true, genOnline: from.opts.genOnline ?? true, battery: true },
      running: from.running,
    },
    { id: 'genStop', seconds: SIM_TIMING.retransfer + SIM_TIMING.cooldown, opts: { ...FULL_AUTOMATION }, running: [] },
  ]
  const out: SimStep[] = []
  let prev = from.analysis
  let prevSig = signature(prev, model)
  let prevRunning = from.running.length
  for (const st of stages) {
    const a = analyze(model, th, baseScenario, base, st.opts)
    markRunning(a, st.running)
    const sig = signature(a, model)
    if (st.id !== 'clear' && sig === prevSig && st.running.length === prevRunning) continue
    const { changes, changedNodes } = diffAnalyses(model, prev, a, [], base)
    if (st.id === 'clear') for (const n of names.slice().reverse()) changes.unshift({ kind: 'cleared', text: tr.sim.changeCleared(n) })
    out.push({
      id: st.id,
      title: tr.sim.stages[st.id],
      description: tr.sim.stageDesc[st.id],
      seconds: st.seconds,
      timeLabel: timeLabel(st.seconds),
      analysis: a,
      changes,
      changedNodes: [...new Set([...changedNodes, ...(st.id === 'clear' ? failedIds : [])])],
      lostKw: Math.max(0, a.unserved.totalKw - base.unserved.totalKw),
      phase: 'recovery',
      opts: st.opts,
      running: st.running,
    })
    prev = a
    prevSig = sig
    prevRunning = st.running.length
  }
  return out
}
