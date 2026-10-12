import { EQUIPMENT } from '../library/equipment'
import type { EdgeState, Scenario } from '../model/types'
import { analyze } from './analyze'
import { isCoolingSystem } from './coolingUnits'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, Model, Thresholds } from './types'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface RedundancyCheck {
  id: string
  title: string
  status: CheckStatus
  detail: string
}

/** Tek bir arıza adayı (ekipman veya hat) için tarama sonucu. */
export interface FailureScan {
  kind: 'node' | 'edge'
  id: string
  label: string
  type?: string
  /** Temel duruma göre kaybedilen yük, kW (soğutma birimleri hariç; soğutma ayrıca değerlendirilir). */
  lostKw: number
  /** Arıza anında trafo/jeneratör/UPS en yüksek doluluğu, %. */
  trafoPeak: number
  genPeak: number
  upsPeak: number
  coolingDeficitKw: number
}

export interface RedundancyReport {
  checks: RedundancyCheck[]
  scans: FailureScan[]
  /** Tekil arıza noktaları: yük kaybettiren tek arızalar (kayıp azalan). */
  spof: FailureScan[]
  /** N-1'e dayanan arıza sayısı / toplam aday. */
  survived: number
  total: number
}

const num = (n: { params: Record<string, string | number>; type: keyof typeof EQUIPMENT }, key: string): number => {
  const v = n.params[key]
  if (typeof v === 'number') return v
  const d = EQUIPMENT[n.type].defaults[key]
  return typeof d === 'number' ? d : 0
}

const peakOf = (a: Analysis, model: Model, type: string): number => {
  let m = 0
  for (const n of model.nodes) {
    if (n.type !== type) continue
    const r = a.nodes[n.id]
    if (r?.energized && r.loadingPct !== undefined) m = Math.max(m, r.loadingPct)
  }
  return m
}

/** Soğutma birimi olmayan yüklerin kaybedilen gücü (soğutma birimleri ayrıca değerlendirilir). */
function unservedNoCooling(a: Analysis, model: Model): number {
  let cool = 0
  for (const n of model.nodes) if (isCoolingSystem(n)) cool += a.nodes[n.id]?.unservedKw ?? 0
  return a.unserved.totalKw - cool
}

const fmt0 = (v: number): string => Math.round(v).toLocaleString('tr-TR')

/** Her yük-dışı ekipman ve her kapalı hat için tek arıza taraması (operatör müdahalesi yok). */
export function scanFailures(model: Model, th: Thresholds = DEFAULT_THRESHOLDS, base?: Analysis, baseScenario?: Scenario): FailureScan[] {
  const b = base ?? analyze(model, th, baseScenario)
  const nameOf = new Map(model.nodes.map((n) => [n.id, n.ad]))
  const out: FailureScan[] = []
  const run = (scenario: Scenario): Analysis => analyze(model, th, scenario, b, { studies: false })
  // Soğutma birimleri (chiller/CRAH) kaybı yük kaybı sayılmaz; soğutma yeterliliği ayrıca değerlendirilir.
  const mk = (kind: 'node' | 'edge', id: string, label: string, type: string | undefined, a: Analysis): FailureScan => ({
    kind,
    id,
    label,
    type,
    lostKw: Math.max(0, unservedNoCooling(a, model) - unservedNoCooling(b, model)),
    trafoPeak: peakOf(a, model, 'trafo'),
    genPeak: peakOf(a, model, 'jenerator'),
    upsPeak: peakOf(a, model, 'ups'),
    coolingDeficitKw: a.cooling?.deficitKw ?? 0,
  })
  const failed0 = baseScenario?.failedNodes ?? []
  for (const n of model.nodes) {
    if ((!EQUIPMENT[n.type].hasOutput && !isCoolingSystem(n)) || failed0.includes(n.id)) continue
    const a = run({ id: `r-${n.id}`, ad: n.ad, failedNodes: [...failed0, n.id], edgeStates: { ...(baseScenario?.edgeStates ?? {}) }, nodeStates: { ...(baseScenario?.nodeStates ?? {}) } })
    out.push(mk('node', n.id, n.ad, n.type, a))
  }
  for (const e of model.edges) {
    if ((baseScenario?.edgeStates[e.id] ?? e.durum) !== 'kapali') continue
    const label = `${nameOf.get(e.source) ?? e.source} → ${nameOf.get(e.target) ?? e.target}`
    const states: Record<string, EdgeState> = { ...(baseScenario?.edgeStates ?? {}), [e.id]: 'acik' }
    const a = run({ id: `r-${e.id}`, ad: label, failedNodes: [...failed0], edgeStates: states, nodeStates: { ...(baseScenario?.nodeStates ?? {}) } })
    out.push(mk('edge', e.id, label, undefined, a))
  }
  return out
}

/** Kapasite ve yedeklilik özeti: N-1 dayanımı, jeneratör, UPS, trafo ve soğutma kontrolleri. */
export function redundancyReport(model: Model, th: Thresholds = DEFAULT_THRESHOLDS): RedundancyReport {
  const base = analyze(model, th)
  const scans = scanFailures(model, th, base)
  const spof = scans.filter((s) => s.lostKw > 0.5).sort((a, b) => b.lostKw - a.lostKw)
  const checks: RedundancyCheck[] = []

  // 1) Genel N-1
  checks.push({
    id: 'n1',
    title: 'Tek arızaya dayanım (N-1)',
    status: spof.length === 0 ? 'ok' : 'fail',
    detail:
      spof.length === 0
        ? `${scans.length} tek arıza adayının hiçbiri yük kaybettirmiyor.`
        : `${spof.length} tekil arıza noktası yük kaybettiriyor (en büyük: ${spof[0].label}, ${fmt0(spof[0].lostKw)} kW).`,
  })

  // 2) Jeneratör: şebeke tümüyle kaybolunca yük + tek jeneratör kaybı (N+1)
  const gens = model.nodes.filter((n) => n.type === 'jenerator')
  const grids = model.nodes.filter((n) => n.type === 'sebeke').map((n) => n.id)
  if (gens.length === 0) {
    checks.push({ id: 'gen', title: 'Jeneratör yedeği', status: 'warn', detail: 'Şemada jeneratör yok: şebeke kaybında yedek kaynak bulunmuyor.' })
  } else if (grids.length > 0) {
    const noGrid = analyze(model, th, { id: 'r-grid', ad: 'Şebeke kaybı', failedNodes: grids, edgeStates: {}, nodeStates: {} }, base, { studies: false })
    const capKw = gens.reduce((s, g) => s + num(g, 'nominalKva') * num(g, 'pf'), 0)
    const loadKw = gens.reduce((s, g) => s + (noGrid.nodes[g.id]?.totalKw ?? 0), 0)
    const lostGrid = Math.max(0, unservedNoCooling(noGrid, model) - unservedNoCooling(base, model))
    let worstOneGen = 0
    let worstLost = 0
    let worstName = ''
    for (const g of gens) {
      const a = analyze(model, th, { id: 'r-g', ad: g.ad, failedNodes: [...grids, g.id], edgeStates: {}, nodeStates: {} }, base, { studies: false })
      const lost = Math.max(0, unservedNoCooling(a, model) - unservedNoCooling(noGrid, model))
      if (lost > worstLost) {
        worstLost = lost
        worstName = g.ad
      }
      worstOneGen = Math.max(worstOneGen, peakOf(a, model, 'jenerator'))
    }
    const status: CheckStatus = lostGrid > 0.5 ? 'fail' : worstLost > 0.5 || worstOneGen > 100 ? 'warn' : 'ok'
    checks.push({
      id: 'gen',
      title: 'Jeneratör kapasitesi ve yedekliliği (şebeke kaybı)',
      status,
      detail:
        `Şebeke kaybında jeneratörler ${fmt0(loadKw)} kW taşır (toplam kapasite ${fmt0(capKw)} kW, %${fmt0(capKw > 0 ? (loadKw / capKw) * 100 : 0)}). ` +
        (lostGrid > 0.5 ? `Yine de ${fmt0(lostGrid)} kW yük jeneratörle beslenemiyor. ` : '') +
        (gens.length > 1
          ? worstLost > 0.5
            ? `Bir jeneratör de kaybolursa (${worstName}) ${fmt0(worstLost)} kW daha kaybedilir (N+1 sağlanmıyor).`
            : worstOneGen > 100
              ? `Bir jeneratör kaybında kalan jeneratör %${fmt0(worstOneGen)} yüklenir (aşırı yük).`
              : 'Bir jeneratör kaybında yük kalan jeneratörlerce taşınır (N+1 sağlanıyor).'
          : 'Tek jeneratör var: yedeklilik yok (N).'),
    })
  }

  // 3) UPS: her UPS arızasında yük kaybı + kalan UPS doluluğu
  const upses = model.nodes.filter((n) => n.type === 'ups')
  if (upses.length > 0) {
    const bad = scans.filter((s) => s.type === 'ups' && s.lostKw > 0.5)
    const over = scans.filter((s) => s.type === 'ups' && s.lostKw <= 0.5 && s.upsPeak > 100)
    checks.push({
      id: 'ups',
      title: 'UPS yedekliliği',
      status: bad.length > 0 ? 'fail' : over.length > 0 ? 'warn' : 'ok',
      detail:
        bad.length > 0
          ? `${bad.map((b) => b.label).join(', ')} arızasında yük kaybedilir (N+1 yok).`
          : over.length > 0
            ? `${over.map((b) => b.label).join(', ')} arızasında kalan UPS aşırı yüklenir.`
            : `${upses.length} UPS: herhangi birinin arızasında yük kaybı yok ve kalan UPS'ler aşırı yüklenmiyor.`,
    })
  }

  // 4) Trafo doluluğu (taban ve en kötü N-1)
  const trafos = model.nodes.filter((n) => n.type === 'trafo')
  if (trafos.length > 0) {
    const basePeak = peakOf(base, model, 'trafo')
    const worstN1 = scans.reduce((m, s) => Math.max(m, s.trafoPeak), 0)
    const status: CheckStatus = basePeak > th.overPct || worstN1 > th.overPct ? (basePeak > th.overPct ? 'fail' : 'warn') : basePeak >= th.warnPct ? 'warn' : 'ok'
    checks.push({
      id: 'trafo',
      title: 'Trafo doluluğu',
      status,
      detail: `Normal çalışmada en yüksek %${fmt0(basePeak)}; tek arıza durumunda en kötü %${fmt0(worstN1)}${worstN1 > th.overPct ? ' (aşırı yük)' : ''}.`,
    })
  }

  // 5) Soğutma
  if (base.cooling) {
    // Yük kaybettiren (tekil nokta) arızalar soğutma ihtiyacını da yok ettiğinden, ihtiyacın %2'sinden küçük açıklar yok sayılır.
    const minDeficit = Math.max(0.5, base.cooling.demandKw * 0.02)
    const worst = scans.reduce<FailureScan | undefined>((m, s) => (s.coolingDeficitKw > minDeficit && (!m || s.coolingDeficitKw > m.coolingDeficitKw) ? s : m), undefined)
    const deficit = worst?.coolingDeficitKw ?? 0
    const status: CheckStatus = base.cooling.deficitKw > 0.5 ? 'fail' : deficit > 0.5 ? 'warn' : 'ok'
    checks.push({
      id: 'cooling',
      title: 'Soğutma yedekliliği',
      status,
      detail:
        base.cooling.deficitKw > 0.5
          ? `Normal çalışmada bile ${fmt0(base.cooling.deficitKw)} kW soğutma açığı var.`
          : deficit > 0.5
            ? `${worst!.label} arızasında ${fmt0(deficit)} kW soğutma açığı oluşur (N+1 soğutma yok).`
            : `Soğutma kapasitesi (${fmt0(base.cooling.capacityKw)} kW) tek arızada da ihtiyacı (${fmt0(base.cooling.demandKw)} kW) karşılıyor.`,
    })
  }

  return { checks, scans, spof, survived: scans.length - spof.length, total: scans.length }
}

export interface MaintenanceRow {
  kind: 'node' | 'edge'
  id: string
  label: string
  lostKw: number
}

export interface MaintenanceReport {
  /** Bakım nedeniyle (arıza yokken) kaybedilen yük. */
  maintenanceLostKw: number
  /** Bakım sürerken yük kaybettiren ikinci arızalar (kayıp azalan). */
  risky: MaintenanceRow[]
  /** Bakım sırasında yük kaybettirmeyen ikinci arıza sayısı / toplam. */
  safe: number
  total: number
}

/**
 * Bakım modu: bir ekipman planlı olarak devre dışı bırakılır (arıza gibi enerjisiz); bu durumdayken
 * hangi ikinci arızanın yük kaybettireceği taranır.
 */
export function maintenanceScan(model: Model, maintId: string, th: Thresholds = DEFAULT_THRESHOLDS): MaintenanceReport {
  const base = analyze(model, th)
  const maintScenario: Scenario = { id: 'bakim', ad: 'Bakım', failedNodes: [maintId], edgeStates: {}, nodeStates: {} }
  const maint = analyze(model, th, maintScenario, base)
  const maintenanceLostKw = Math.max(0, maint.unserved.totalKw - base.unserved.totalKw)
  const scans = scanFailures(model, th, maint, maintScenario)
  const risky = scans
    .filter((s) => s.lostKw > 0.5)
    .map((s) => ({ kind: s.kind, id: s.id, label: s.label, lostKw: s.lostKw }))
    .sort((a, b) => b.lostKw - a.lostKw)
  return { maintenanceLostKw, risky, safe: scans.length - risky.length, total: scans.length }
}
