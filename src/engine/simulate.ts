import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { ProjectNode, Scenario } from '../model/types'
import { FULL_AUTOMATION } from './automation'
import type { SimOptions } from './automation'
import type { ProjectSettings } from '../model/settings'
import { DEFAULT_SETTINGS } from '../model/settings'
import { analyze } from './analyze'
import { rideThroughMinutes } from './cooling'
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
  | 'cooling'
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
  /** Bu adımdan sonra hâlâ arızalı olan (simülasyonda arıza verilen) ekipman. */
  failed: string[]
  /** Batarya durumu: bataryaya geçmiş veya şarjı azalmış UPS'ler. */
  battery: BatteryInfo[]
}

export interface BatteryInfo {
  id: string
  name: string
  /** Kalan şarj, %. */
  socPct: number
  /** O anki yükle kalan süre, dk (bataryadaysa). */
  remainingMin?: number
  onBattery: boolean
  depleted: boolean
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
  settings: ProjectSettings = DEFAULT_SETTINGS,
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
  if (cur.cooling && prev.cooling) {
    const d0 = prev.cooling.deficitKw
    const d1 = cur.cooling.deficitKw
    if (d1 > 0.5 && d0 <= 0.5) {
      changes.push({ kind: 'cooling', text: tr.sim.coolingShort(fmt(d1), fmt(d1 / 3.517, 1), fmt(rideThroughMinutes(d1, settings), 0), fmt(settings.izinliArtis)) })
    } else if (d1 <= 0.5 && d0 > 0.5) {
      changes.push({ kind: 'cooling', text: tr.sim.coolingOk })
    }
  }
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

const runningGens = (a: Analysis): string[] => Object.values(a.nodes).filter((r) => r.running).map((r) => r.id)

// --- UPS batarya enerjisi ------------------------------------------------------

type Soc = Map<string, number>

/** UPS bataryasının o anki yükle toplam çalışma süresi (dk): bataryaDk × nominal kW / çıkış kW (doğrusal enerji). */
export function batteryRuntimeMin(model: Model, a: Analysis, upsId: string): number {
  const n = model.nodes.find((x) => x.id === upsId)
  if (!n) return Infinity
  const out = a.nodes[upsId]?.totalKw ?? 0
  const cap = typeof n.params.nominalKw === 'number' ? n.params.nominalKw : (EQUIPMENT.ups.defaults.nominalKw as number)
  const dk = typeof n.params.bataryaDk === 'number' ? n.params.bataryaDk : (EQUIPMENT.ups.defaults.bataryaDk as number)
  if (out <= 0.5) return Infinity
  return (dk * cap) / out
}

function initialSoc(model: Model, from?: SimStep): Soc {
  const soc: Soc = new Map()
  for (const n of model.nodes) if (n.type === 'ups') soc.set(n.id, 1)
  for (const b of from?.battery ?? []) soc.set(b.id, b.socPct / 100)
  return soc
}

/** Önceki adımın yüküyle `dt` saniye boşalma. */
function advanceSoc(model: Model, soc: Soc, prev: Analysis, dtSec: number): void {
  if (dtSec <= 0) return
  for (const [id, v] of soc) {
    if (!prev.nodes[id]?.onBattery) continue
    const rt = batteryRuntimeMin(model, prev, id)
    soc.set(id, Math.max(0, v - (Number.isFinite(rt) && rt > 0 ? dtSec / 60 / rt : rt === 0 ? 1 : 0)))
  }
}

function batteryList(model: Model, soc: Soc, a: Analysis): BatteryInfo[] {
  const out: BatteryInfo[] = []
  for (const n of model.nodes) {
    if (n.type !== 'ups') continue
    const v = soc.get(n.id) ?? 1
    const on = !!a.nodes[n.id]?.onBattery
    if (v > 0.999 && !on) continue
    const rt = on ? batteryRuntimeMin(model, a, n.id) : Infinity
    out.push({ id: n.id, name: n.ad, socPct: v * 100, remainingMin: on && Number.isFinite(rt) ? v * rt : undefined, onBattery: on, depleted: v <= 1e-6 })
  }
  return out
}

// --- ortak aşama çalıştırıcı ------------------------------------------------------

interface StageDef {
  id: SimStageId
  /** Başlangıca göre (mutlak) süre, sn. */
  seconds: number
  opts: Partial<SimOptions>
  /** Jeneratörler bu aşamada çalıştırılmış sayılır (yük taşıyanlar). */
  gens: boolean
}

interface PlayCtx {
  model: Model
  th: Thresholds
  settings: ProjectSettings
  base: Analysis
  scenario: Scenario | undefined
  soc: Soc
  phase: 'fault' | 'recovery'
  /** Adımlara yazılacak hâlâ arızalı ekipman. */
  failed: string[]
  /** Vurgulanacak (arıza/giderme) ekipman. */
  mark: string[]
  steps: SimStep[]
  prev: Analysis
  prevSeconds: number
}

function pushStep(
  ctx: PlayCtx,
  def: StageDef,
  a: Analysis,
  extra: { faultNames?: string[]; clearedNames?: string[]; changesPrefix?: SimChange[]; title?: string; markIds?: string[] } = {},
): void {
  const { model, base, settings } = ctx
  advanceSoc(model, ctx.soc, ctx.prev, def.seconds - ctx.prevSeconds)
  const { changes, changedNodes } = diffAnalyses(model, ctx.prev, a, extra.faultNames ?? [], base, settings)
  for (const c of (extra.clearedNames ?? []).slice().reverse()) changes.unshift({ kind: 'cleared', text: tr.sim.changeCleared(c) })
  if (extra.changesPrefix) changes.splice((extra.faultNames ?? []).length, 0, ...extra.changesPrefix)
  ctx.steps.push({
    id: def.id,
    title: extra.title ?? tr.sim.stages[def.id],
    description: tr.sim.stageDesc[def.id],
    seconds: def.seconds,
    timeLabel: timeLabel(def.seconds),
    analysis: a,
    changes,
    changedNodes: [...new Set([...changedNodes, ...(extra.markIds ?? [])])],
    lostKw: Math.max(0, a.unserved.totalKw - base.unserved.totalKw),
    phase: ctx.phase,
    opts: def.opts,
    running: runningGens(a),
    failed: ctx.failed,
    battery: batteryList(model, ctx.soc, a),
  })
  ctx.prev = a
  ctx.prevSeconds = def.seconds
}

/**
 * Arıza aşamalarını sırayla çözer (arıza anı, STS, bypass, jeneratör, sıralama) ve ardından batarya
 * tükenmelerini zaman sırasıyla ekler. Değişmeyen aşamalar atlanır.
 */
function playFault(ctx: PlayCtx, t0: number, first: Partial<SimOptions>, opts0: Partial<SimOptions>, faultNames: string[], newIds: string[]): void {
  const { model, th, base, scenario } = ctx
  const run = (o: Partial<SimOptions>) => analyze(model, th, scenario, base, o)
  const depleted = opts0.depleted ?? []
  const keep = { depleted }
  const stages: StageDef[] = [
    { id: 'fault', seconds: t0, opts: { ...first, battery: true, ...keep }, gens: false },
    { id: 'sts', seconds: t0 + SIM_TIMING.sts, opts: { ...opts0, hold: undefined, keepClosed: undefined, battery: true, ...keep }, gens: false },
    { id: 'bypass', seconds: t0 + SIM_TIMING.bypass, opts: { ...opts0, hold: undefined, autoBypass: true, battery: true, ...keep }, gens: false },
    // Jeneratörler zaten çalışıyorsa (ek arıza) yük devri çalıştırma gecikmesi beklemez.
    { id: 'gen', seconds: t0 + (opts0.genOnline ? 0.5 : SIM_TIMING.gen), opts: { autoBypass: true, staging: false, genOnline: true, battery: true, ...keep }, gens: true },
    { id: 'staging', seconds: t0 + SIM_TIMING.staging, opts: { autoBypass: true, staging: true, genOnline: true, battery: true, ...keep }, gens: true },
  ]
  let prevSig = signature(ctx.prev, model)
  let last: { a: Analysis; opts: Partial<SimOptions>; seconds: number } | undefined
  for (const st of stages) {
    const a = run(st.opts)
    if (st.gens) markRunning(a, model.nodes.filter((n) => n.type === 'jenerator' && a.nodes[n.id]?.totalKw > 0.5).map((n) => n.id))
    const sig = signature(a, model)
    if (st.id !== 'fault' && sig === prevSig) continue
    pushStep(ctx, st, a, st.id === 'fault' ? { faultNames, markIds: newIds } : {})
    prevSig = sig
    last = { a, opts: st.opts, seconds: st.seconds }
  }
  if (!last) return

  // Batarya tükenmeleri: bataryadaki UPS'lerin kalan süresi o anki yükle hesaplanır; en erken biten UPS için
  // yeni bir adım eklenir ve yük yeniden çözülür (birden çok UPS farklı zamanlarda tükenebilir).
  const dead = new Set(depleted)
  let cur = last
  for (let guard = 0; guard < model.nodes.length; guard++) {
    let soonest: { id: string; dt: number } | undefined
    for (const n of model.nodes) {
      if (n.type !== 'ups' || dead.has(n.id) || !cur.a.nodes[n.id]?.onBattery) continue
      const rt = batteryRuntimeMin(model, cur.a, n.id)
      if (!Number.isFinite(rt)) continue
      const dt = (ctx.soc.get(n.id) ?? 1) * rt * 60
      if (!soonest || dt < soonest.dt) soonest = { id: n.id, dt }
    }
    if (!soonest) break
    // Aynı anda biten UPS'ler tek adımda toplanır.
    const T = cur.seconds + soonest.dt
    const batch = model.nodes
      .filter((n) => n.type === 'ups' && !dead.has(n.id) && cur.a.nodes[n.id]?.onBattery)
      .filter((n) => {
        const rt = batteryRuntimeMin(model, cur.a, n.id)
        return Number.isFinite(rt) && Math.abs((ctx.soc.get(n.id) ?? 1) * rt * 60 - soonest!.dt) < 0.5
      })
    for (const u of batch) dead.add(u.id)
    const opts: Partial<SimOptions> = { autoBypass: true, staging: true, genOnline: true, battery: true, depleted: [...dead] }
    const def: StageDef = { id: 'battery', seconds: T, opts, gens: true }
    const a = run(opts)
    markRunning(a, model.nodes.filter((n) => n.type === 'jenerator' && a.nodes[n.id]?.totalKw > 0.5).map((n) => n.id))
    // Bu UPS'in şarjı tükendi: izleyici bu anda sıfırlanır.
    advanceSoc(model, ctx.soc, cur.a, T - cur.seconds)
    for (const u of batch) ctx.soc.set(u.id, 0)
    ctx.prevSeconds = T // advanceSoc pushStep içinde tekrar uygulanmasın
    ctx.prev = cur.a
    pushStepNoAdvance(ctx, def, a, batch.map((u) => u.ad))
    cur = { a, opts, seconds: T }
  }
}

/** Batarya tükenme adımı: şarj zaten güncellendi; ayrıca "bataryası tükendi" satırı yazılır. */
function pushStepNoAdvance(ctx: PlayCtx, def: StageDef, a: Analysis, names: string[]): void {
  const prevSeconds = ctx.prevSeconds
  const prevAnalysis = ctx.prev
  const { changes, changedNodes } = diffAnalyses(ctx.model, prevAnalysis, a, [], ctx.base, ctx.settings)
  changes.unshift({ kind: 'battery', text: tr.sim.batteryEmpty(names.join(', ')) })
  ctx.steps.push({
    id: def.id,
    title: tr.sim.stages.battery,
    description: tr.sim.stageDesc.battery,
    seconds: def.seconds,
    timeLabel: timeLabel(def.seconds),
    analysis: a,
    changes,
    changedNodes,
    lostKw: Math.max(0, a.unserved.totalKw - ctx.base.unserved.totalKw),
    phase: ctx.phase,
    opts: def.opts,
    running: runningGens(a),
    failed: ctx.failed,
    battery: batteryList(ctx.model, ctx.soc, a),
  })
  ctx.prev = a
  ctx.prevSeconds = Math.max(prevSeconds, def.seconds)
}

const emptyCtx = (model: Model, th: Thresholds, settings: ProjectSettings, base: Analysis, scenario: Scenario | undefined, soc: Soc, phase: 'fault' | 'recovery', failed: string[], prev: Analysis, prevSeconds: number): PlayCtx => ({
  model, th, settings, base, scenario, soc, phase, failed, mark: [], steps: [], prev, prevSeconds,
})

/**
 * Seçilen ekipman(lar)ın arızasını aşama aşama çözer: arıza anı, STS transferi, otomatik bypass,
 * jeneratörlerin devreye girmesi, jeneratör yük sıralaması ve UPS batarya tükenmeleri. Her aşama, o ana kadar
 * devreye girmiş otomasyonlarla kararlı durum çözümüdür; değişmeyen aşamalar atlanır.
 */
export function simulateFailure(
  model: Model,
  failedIds: string[],
  baseScenario?: Scenario,
  th: Thresholds = DEFAULT_THRESHOLDS,
  settings: ProjectSettings = DEFAULT_SETTINGS,
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
  const soc = initialSoc(model)
  const ctx = emptyCtx(model, th, settings, base, scenario, soc, 'fault', failedIds, base, 0)
  ctx.steps.push({
    id: 'normal',
    title: tr.sim.stages.normal,
    description: tr.sim.stageDesc.normal,
    seconds: -1,
    timeLabel: '',
    analysis: base,
    changes: [],
    changedNodes: [],
    lostKw: 0,
    phase: 'fault',
    opts: { ...FULL_AUTOMATION },
    running: [],
    failed: [],
    battery: [],
  })
  const hold = holdFrom(base, model)
  playFault(
    ctx,
    0,
    { autoBypass: false, staging: false, genOnline: false, hold },
    { autoBypass: false, staging: false, genOnline: false },
    faultNames,
    failedIds,
  )
  return ctx.steps
}

/**
 * Sıralı arıza: simülasyon `from` adımındayken ek ekipman arızalanır. Mevcut durum (transferler, bypass,
 * çalışan jeneratörler, batarya şarjı) korunarak arıza aşamaları o andan başlayarak yeniden çözülür; dönen
 * adımlar `from`dan sonra eklenir (zamanlar mutlaktır).
 */
export function simulateAdditionalFault(
  model: Model,
  from: SimStep,
  newIds: string[],
  baseScenario?: Scenario,
  th: Thresholds = DEFAULT_THRESHOLDS,
  settings: ProjectSettings = DEFAULT_SETTINGS,
): SimStep[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const add = newIds.filter((id) => !from.failed.includes(id) && byId.has(id))
  if (add.length === 0) return []
  const failedAll = [...from.failed, ...add]
  const scenario: Scenario = {
    id: 'sim',
    ad: 'sim',
    failedNodes: [...new Set([...(baseScenario?.failedNodes ?? []), ...failedAll])],
    edgeStates: baseScenario?.edgeStates ?? {},
    nodeStates: baseScenario?.nodeStates ?? {},
  }
  const base = analyze(model, th, baseScenario)
  const t0 = Math.max(0, from.seconds)
  const ctx = emptyCtx(model, th, settings, base, scenario, initialSoc(model, from), 'fault', failedAll, from.analysis, t0)
  const keepClosed = model.nodes.filter((n) => from.analysis.nodes[n.id]?.autoClosed).map((n) => n.id)
  const o = from.opts
  const carry: Partial<SimOptions> = { autoBypass: o.autoBypass ?? true, staging: o.staging ?? false, genOnline: o.genOnline ?? false, depleted: o.depleted }
  playFault(ctx, t0, { ...carry, hold: holdFrom(from.analysis, model, true), keepClosed }, carry, add.map((id) => byId.get(id)?.ad ?? id), add)
  return ctx.steps
}

/**
 * Arızanın `from` adımından itibaren giderilmesini çözer. `clearIds` verilen ekipmanın arızası kalkar,
 * diğer arızalar sürer. Adımlar: arıza giderildi (transferler, bypass ve jeneratör kolu eski konumunda,
 * onarılan jeneratör henüz çalışmıyor), normal kaynağa geri transfer (bypass açılır, jeneratörler
 * yüksüz çalışır), jeneratör soğutma sonrası durur (yük taşımaya devam edenler hariç).
 * Dönen adımlar `from`dan sonra eklenir.
 */
export function simulateRecovery(
  model: Model,
  from: SimStep,
  clearIds: string[],
  baseScenario?: Scenario,
  th: Thresholds = DEFAULT_THRESHOLDS,
  settings: ProjectSettings = DEFAULT_SETTINGS,
): SimStep[] {
  const base = analyze(model, th, baseScenario)
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const cleared = from.failed.filter((id) => clearIds.includes(id))
  const remaining = from.failed.filter((id) => !clearIds.includes(id))
  const scenario: Scenario | undefined =
    remaining.length === 0
      ? baseScenario
      : {
          id: 'sim',
          ad: 'sim',
          failedNodes: [...new Set([...(baseScenario?.failedNodes ?? []), ...remaining])],
          edgeStates: baseScenario?.edgeStates ?? {},
          nodeStates: baseScenario?.nodeStates ?? {},
        }
  const keepClosed = model.nodes.filter((n) => from.analysis.nodes[n.id]?.autoClosed).map((n) => n.id)
  const repairedGens = cleared.filter((id) => byId.get(id)?.type === 'jenerator')
  const carrying = (a: Analysis): string[] => model.nodes.filter((n) => n.type === 'jenerator' && a.nodes[n.id]?.totalKw > 0.5).map((n) => n.id)
  const stillRunning = from.running.filter((id) => !remaining.includes(id) && !repairedGens.includes(id))
  const depleted = from.opts.depleted

  const stages: (StageDef & { running: (a: Analysis) => string[] })[] = [
    {
      id: 'clear',
      seconds: 0,
      opts: { ...from.opts, hold: holdFrom(from.analysis, model, true), keepClosed, offGens: repairedGens },
      gens: false,
      running: () => stillRunning,
    },
    {
      id: 'retransfer',
      seconds: SIM_TIMING.retransfer,
      opts: { autoBypass: true, staging: true, genOnline: from.opts.genOnline ?? true, battery: true, depleted },
      gens: false,
      running: (a) => [...new Set([...stillRunning, ...carrying(a)])],
    },
    { id: 'genStop', seconds: SIM_TIMING.retransfer + SIM_TIMING.cooldown, opts: { ...FULL_AUTOMATION, depleted }, gens: false, running: carrying },
  ]
  const ctx = emptyCtx(model, th, settings, base, scenario, initialSoc(model, from), 'recovery', remaining, from.analysis, 0)
  let prevSig = signature(from.analysis, model)
  for (const st of stages) {
    const a = analyze(model, th, scenario, base, st.opts)
    markRunning(a, st.running(a))
    const sig = signature(a, model)
    if (st.id !== 'clear' && sig === prevSig) continue
    pushStep(ctx, st, a, st.id === 'clear' ? { clearedNames: cleared.map((id) => byId.get(id)?.ad ?? id), markIds: cleared } : {})
    prevSig = sig
  }
  return ctx.steps
}
