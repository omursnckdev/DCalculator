import { tr } from '../i18n/tr'
import { EQUIPMENT, portCount } from '../library/equipment'
import { HEAT_LOCATIONS } from '../model/types'
import type { EquipmentType, HeatLocation, ProjectEdge, ProjectNode, Scenario } from '../model/types'
import { resolveAutoClosed, stagingStandby, withDefaults } from './automation'
import type { SimOptions } from './automation'
import { energize } from './energize'
import { switchState } from './switches'
import { DEFAULT_THRESHOLDS, statusOf } from './thresholds'
import type {
  Analysis,
  Demand,
  EdgeResult,
  ExplainStep,
  HeatSummary,
  Issue,
  LossBreakdown,
  Model,
  NodeResult,
  PQ,
  Thresholds,
  Totals,
  Unserved,
} from './types'

const SQRT3 = Math.sqrt(3)
const LOAD_TYPES: EquipmentType[] = ['itYuku', 'mekanikYuk', 'aydinlatma', 'genelYuk']
const PANEL_TYPES: EquipmentType[] = ['mdb', 'dagitimPanosu', 'bara', 'upsPanosu', 'pdu', 'ats', 'sts', 'kesici', 'senkron']
const TRANSFER_TYPES: EquipmentType[] = ['ats', 'sts']

// --- küçük yardımcılar -----------------------------------------------------

const zeroPQ = (): PQ => ({ p: 0, q: 0 })
const zeroDemand = (): Demand => ({ it: zeroPQ(), mech: zeroPQ(), loss: zeroPQ() })

function addScaled(into: Demand, d: Demand, k: number): void {
  for (const key of ['it', 'mech', 'loss'] as const) {
    into[key].p += d[key].p * k
    into[key].q += d[key].q * k
  }
}

function sumPQ(d: Demand): PQ {
  return { p: d.it.p + d.mech.p + d.loss.p, q: d.it.q + d.mech.q + d.loss.q }
}

const kvaOf = (pq: PQ): number => Math.hypot(pq.p, pq.q)
const tanPhi = (pf: number): number => {
  const c = Math.min(1, Math.max(1e-6, pf))
  return Math.tan(Math.acos(c))
}
/** Üç fazlı akım (A): kVA·1000 / (√3·V). */
export const currentOf = (kva: number, volts: number): number =>
  volts > 0 ? (kva * 1000) / (SQRT3 * volts) : 0

// Intl.NumberFormat örneği pahalıdır; basamak sayısına göre önbelleğe alınır.
const formatters = new Map<number, Intl.NumberFormat>()
const fmt = (v: number, d = 2): string => {
  let f = formatters.get(d)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: d })
    formatters.set(d, f)
  }
  return f.format(v)
}

/** Düğüm parametresi; eksikse (eski dosyalar) kütüphane varsayılanına düşer. */
function param(n: ProjectNode, key: string): number {
  const v = n.params[key]
  if (typeof v === 'number') return v
  const d = EQUIPMENT[n.type].defaults[key]
  return typeof d === 'number' ? d : 0
}

/** Düğümün alt (çıkış) tarafındaki gerilim, V. */
export function outVoltage(n: ProjectNode): number {
  switch (n.type) {
    case 'trafo':
      return param(n, 'sekonderGerilim')
    case 'ups':
      return param(n, 'cikisGerilim')
    default:
      return param(n, 'gerilim')
  }
}

/** Düğümün üst (giriş) tarafındaki gerilim, V. */
export function inVoltage(n: ProjectNode): number {
  switch (n.type) {
    case 'trafo':
      return param(n, 'primerGerilim')
    case 'ups':
      return param(n, 'girisGerilim')
    default:
      return param(n, 'gerilim')
  }
}

/** Düğümün diversity faktörü (yalnız pano tiplerinde anlamlı; yoksa 1). */
function diversityOf(n: ProjectNode): number {
  if (!PANEL_TYPES.includes(n.type)) return 1
  const raw = n.params.diversity ?? EQUIPMENT[n.type].defaults.diversity
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
}

function heatLocation(n: ProjectNode): HeatLocation {
  const v = n.params.isiKonum ?? EQUIPMENT[n.type].defaults.isiKonum
  return HEAT_LOCATIONS.includes(v as HeatLocation) ? (v as HeatLocation) : 'elektrik'
}

/**
 * UPS verimi (0..1). 'sabit' modda tek değer; 'egri' modda yük oranına (çıkış kW /
 * nominal kW) göre %25/50/75/100 noktaları arasında doğrusal enterpolasyon.
 * %25'in altında ilk, %100'ün üstünde son nokta sabit tutulur (Açık Soru 14).
 */
export function upsEfficiency(n: ProjectNode, loadFraction: number): number {
  const mode = n.params.verimModu ?? EQUIPMENT.ups.defaults.verimModu
  const clamp = (v: number) => Math.min(1, Math.max(0.01, v / 100))
  if (mode !== 'egri') return clamp(param(n, 'verim'))
  const pts: [number, number][] = [
    [0.25, param(n, 'verim25')],
    [0.5, param(n, 'verim50')],
    [0.75, param(n, 'verim75')],
    [1, param(n, 'verim100')],
  ]
  const x = loadFraction
  if (x <= pts[0][0]) return clamp(pts[0][1])
  if (x >= pts[3][0]) return clamp(pts[3][1])
  for (let i = 0; i < 3; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    if (x <= x1) return clamp(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0))
  }
  return clamp(pts[3][1])
}

// --- ana hesap -------------------------------------------------------------

/**
 * Şemayı çözümler. `scenario` verilirse arızalı ekipman enerjisiz sayılır ve
 * hat anahtar durumları senaryoya göre geçersiz kılınır; yük, sağlam hatlara yeniden
 * dağıtılır (2N, yedek jeneratör, ATS/STS, bara kuplajı).
 */
export function analyze(
  model: Model,
  th: Thresholds = DEFAULT_THRESHOLDS,
  scenario?: Scenario,
  baseResult?: Analysis,
  sim?: Partial<SimOptions>,
): Analysis {
  const opts = withDefaults(sim)
  // 1) Otomatik kapanan kesiciler (yapısal ön hesap). 2) Çözüm. 3) Jeneratör yük sıralaması: gerekirse
  // fazla jeneratör devre dışı bırakılıp yeniden çözülür.
  const autoClosed = resolveAutoClosed(model, scenario, opts, new Set())
  let res = analyzeCore(model, th, scenario, baseResult, opts, autoClosed, new Set())
  const standby = opts.staging && opts.genOnline ? stagingStandby(model, res, scenario) : new Set<string>()
  if (standby.size > 0) {
    const closed2 = resolveAutoClosed(model, scenario, opts, standby)
    res = analyzeCore(model, th, scenario, baseResult, opts, closed2, standby)
    for (const id of standby) res.nodes[id] = { ...res.nodes[id], energized: true, standby: true }
  }
  return res
}

function analyzeCore(
  model: Model,
  th: Thresholds,
  scenario: Scenario | undefined,
  baseResult: Analysis | undefined,
  opts: SimOptions,
  autoClosed: Set<string>,
  standby: Set<string>,
): Analysis {
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]))
  const failed = new Set((scenario?.failedNodes ?? []).filter((id) => nodeById.has(id)))
  const openSwitches = new Set(
    model.nodes.filter((n) => switchState(n, scenario) === 'acik' && !autoClosed.has(n.id)).map((n) => n.id),
  )
  const allEdges = model.edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
  // Açık anahtarlı hatlar şemada yok sayılır (hem akış hem döngü denetimi için).
  const edges = allEdges.filter((e) => (scenario?.edgeStates[e.id] ?? e.durum) === 'kapali')
  // Bağlantı sayıları açık anahtarlı hatları da sayar (açık hat 'bağlantısız' demek değildir).
  const allIn = new Map<string, number>()
  const allOut = new Map<string, number>()
  for (const e of allEdges) {
    allOut.set(e.source, (allOut.get(e.source) ?? 0) + 1)
    allIn.set(e.target, (allIn.get(e.target) ?? 0) + 1)
  }
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

  const issues: Issue[] = []

  // 1) Topolojik sıra (Kahn). Sıraya girmeyenler döngü içinde / döngüden beslenir.
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
  const inOrder = new Set(order)

  // 2) Besleme payları: hedef düğümün talebi gelen hatlara bölüştürülür.
  const share = new Map<string, number>() // edgeId -> 0..1
  for (const n of model.nodes) {
    const ins = incoming.get(n.id)!.filter((e) => inOrder.has(e.source) && inOrder.has(e.target))
    if (ins.length === 0) continue
    const explicit = ins.filter((e) => e.pay !== null)
    const auto = ins.filter((e) => e.pay === null)
    const clamp = (v: number) => Math.min(100, Math.max(0, v))
    const sumExplicit = explicit.reduce((a, e) => a + clamp(e.pay as number), 0)
    for (const e of explicit) share.set(e.id, clamp(e.pay as number) / 100)
    if (auto.length > 0) {
      const each = Math.max(0, 100 - sumExplicit) / auto.length
      for (const e of auto) share.set(e.id, each / 100)
      if (sumExplicit > 100 + 1e-9) {
        issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.shareOver(n.ad, fmt(sumExplicit)) })
      }
    } else if (Math.abs(sumExplicit - 100) > 1e-6) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.shareSum(n.ad, fmt(sumExplicit)) })
    }
  }

  // 2a) Enerji durumu: kaynaklardan canlı bir yolla beslenen düğümler. Arızalı düğüm
  // enerjisizdir; kaynağı enerjisiz olan hat canlı değildir.
  const dead = new Set<string>([...failed, ...openSwitches, ...standby])
  if (!opts.genOnline) for (const n of model.nodes) if (n.type === 'jenerator') dead.add(n.id)
  const { energized: energizedSet, onBattery } = energize({ nodes: model.nodes, edges, dead, battery: opts.battery, hold: opts.hold })
  const energized = new Map<string, boolean>()
  for (const id of order) energized.set(id, energizedSet.has(id))
  // Normal kaynaktan (şebeke/trafo zinciri) canlı bir yolla besleniyor mu? Jeneratör acil
  // kaynaktır: normal kaynak varken yük almaz, yalnızca normal kaynak kalmayınca devreye girer.
  const normalFed = new Map<string, boolean>()
  for (const id of order) {
    const n = nodeById.get(id)!
    if (energized.get(id) !== true) normalFed.set(id, false)
    else if (!EQUIPMENT[n.type].hasInput) normalFed.set(id, n.type !== 'jenerator')
    else normalFed.set(id, incoming.get(id)!.some((e) => energized.get(e.source) === true && normalFed.get(e.source) === true))
  }
  const edgeLive = (e: ProjectEdge) => energized.get(e.source) === true && energized.get(e.target) === true

  // 2a') Yeniden dağıtım: ölü hatların payı canlı hatlara aktarılır (normal paylarıyla
  // orantılı; hepsi 0 ise eşit). ATS/STS yalnızca tek girişi aktif tutar: canlı girişler
  // arasında en yüksek paylı olanı (eşitlikte ilk hat). Arıza yoksa ve ATS yoksa değişmez.
  for (const n of model.nodes) {
    const ins = incoming.get(n.id)!.filter((e) => share.has(e.id))
    if (ins.length === 0) continue
    const total = ins.reduce((a, e) => a + (share.get(e.id) ?? 0), 0)
    const liveAll = ins.filter(edgeLive)
    // Kaynak seçilen düğümlerde (pano, bara, ATS...) normal kaynaklı canlı giriş varsa acil
    // (jeneratör kaynaklı) girişler yük almaz. Çift kablolu yükler (2N) iki tarafı paylaşır.
    // ATS/STS'de açıkça tercih (pay) verilmişse kullanıcının tercihi geçerlidir; kural yalnız tercih yoksa işler.
    const honorPreference = TRANSFER_TYPES.includes(n.type) && ins.some((e) => e.pay !== null)
    const liveNormal =
      LOAD_TYPES.includes(n.type) || honorPreference ? [] : liveAll.filter((e) => normalFed.get(e.source) === true)
    const live = liveNormal.length > 0 ? liveNormal : liveAll
    const isTransfer = TRANSFER_TYPES.includes(n.type)
    // Simülasyon: normal kaynak döndü ama giriş değiştirme (geri transfer) gecikmesi dolmadı: jeneratör girişi sürer.
    const heldPanel = !isTransfer ? liveAll.find((e) => e.id === opts.hold?.[n.id]) : undefined
    if (heldPanel) {
      const amount = total > 1e-12 ? total : 1
      for (const e of ins) share.set(e.id, e.id === heldPanel.id ? amount : 0)
      continue
    }
    if (live.length === 0) {
      for (const e of ins) share.set(e.id, 0)
      continue
    }
    if (isTransfer) {
      // Eşitlikte en düşük numaralı giriş portu tercih edilir.
      const byPort = [...live].sort((a, b) => a.hedefPort - b.hedefPort)
      let best = byPort[0]
      for (const e of byPort) if ((share.get(e.id) ?? 0) > (share.get(best.id) ?? 0) + 1e-12) best = e
      // Simülasyonda transfer henüz olmadıysa kilitli giriş korunur.
      const heldId = opts.hold?.[n.id]
      if (heldId !== undefined) best = liveAll.find((e) => e.id === heldId) ?? best
      const amount = total > 1e-12 ? total : 1
      for (const e of ins) share.set(e.id, e.id === best.id ? amount : 0)
      continue
    }
    if (live.length === ins.length) continue
    const liveSum = live.reduce((a, e) => a + (share.get(e.id) ?? 0), 0)
    const amount = total > 1e-12 ? total : 1
    for (const e of ins) {
      if (!live.includes(e)) share.set(e.id, 0)
      else share.set(e.id, liveSum > 1e-12 ? ((share.get(e.id) ?? 0) * amount) / liveSum : amount / live.length)
    }
  }

  // 2b) Ağırlık: düğüm talebinin kaynaklardan gerçekten çekilen oranı
  // (pay × kaynak düğümün diversity faktörü, yol boyunca çarpılır). Isıl yük ve
  // kayıp dağılımı toplam çekilen güçle tutarlı kalsın diye kullanılır.
  const weight = new Map<string, number>()
  for (const id of order) {
    const n = nodeById.get(id)!
    if (!EQUIPMENT[n.type].hasInput) {
      weight.set(id, 1)
      continue
    }
    let w = 0
    for (const e of incoming.get(id)!) {
      const k = share.get(e.id)
      if (k === undefined) continue
      const src = nodeById.get(e.source)!
      w += (weight.get(e.source) ?? 0) * diversityOf(src) * k
    }
    weight.set(id, w)
  }

  // 3) Yükten kaynağa doğru: ters topolojik sırada çıkış (O) ve giriş (D) talebi.
  const edgeLoss = new Map<string, PQ>()
  const outDemand = new Map<string, Demand>()
  const inDemand = new Map<string, Demand>()
  const nodeResults: Record<string, NodeResult> = {}

  for (const id of [...order].reverse()) {
    const n = nodeById.get(id)!
    const explain: ExplainStep[] = []
    const out = zeroDemand()
    const en = energized.get(id) ?? false
    let unservedKw = 0

    if (LOAD_TYPES.includes(n.type)) {
      const kw = param(n, 'kuruluKw')
      const df = param(n, 'df')
      const pf = param(n, 'pf')
      const p = kw * df
      const q = p * tanPhi(pf)
      const bucket = n.params.kategori === 'IT' || (n.params.kategori === undefined && n.type === 'itYuku') ? 'it' : 'mech'
      if (en) out[bucket] = { p, q }
      else unservedKw = p
      explain.push({ label: tr.hesap.peakKw, formula: `${fmt(kw)} kW × ${fmt(df)}`, result: `${fmt(p)} kW` })
      explain.push({
        label: tr.hesap.reactive,
        formula: `P × tan(arccos ${fmt(pf)})`,
        result: `${fmt(q)} kvar`,
      })
    } else {
      const acc = zeroDemand()
      for (const e of outgoing.get(id)!) {
        const k = share.get(e.id)
        const child = inDemand.get(e.target)
        if (k === undefined || !child) continue
        addScaled(acc, child, k)
        // Hat kaybı: 3·I²·R·L (P) ve 3·I²·X·L (Q); I, hedef tarafın akımıdır.
        const flow = sumPQ(child)
        const cur = currentOf(Math.hypot(flow.p * k, flow.q * k), e.gerilim)
        const lenKm = e.uzunluk / 1000
        const loss: PQ = { p: (3 * cur * cur * e.r * lenKm) / 1000, q: (3 * cur * cur * e.x * lenKm) / 1000 }
        edgeLoss.set(e.id, loss)
        acc.loss.p += loss.p
        acc.loss.q += loss.q
      }
      const div = diversityOf(n)
      addScaled(out, acc, div)
      const t = sumPQ(out)
      if (div !== 1) {
        explain.push({
          label: tr.hesap.diversity,
          formula: `${fmt(sumPQ(acc).p)} kW × ${fmt(div, 3)}`,
          result: `${fmt(t.p)} kW`,
        })
      }
      explain.push({
        label: tr.hesap.sumLoads,
        formula: `IT ${fmt(out.it.p)} + ${tr.alan.kategoriMekanik} ${fmt(out.mech.p)} + kayıp ${fmt(out.loss.p)}`,
        result: `${fmt(t.p)} kW`,
      })
      explain.push({ label: tr.hesap.sumReactive, formula: 'Σ Q', result: `${fmt(t.q)} kvar` })
    }
    outDemand.set(id, out)

    // Giriş talebi: UPS ve trafoda kendi kaybı eklenir, diğerlerinde aynıdır.
    let input: Demand
    let ownLoss = 0
    if (n.type === 'ups') {
      const girisPf = param(n, 'girisPf')
      const o = sumPQ(out)
      const nomKw = param(n, 'nominalKw')
      const frac = nomKw > 0 ? o.p / nomKw : 0
      const eta = upsEfficiency(n, frac)
      explain.push({
        label: tr.hesap.upsEfficiency,
        formula: n.params.verimModu === 'egri' ? `η(%${fmt(frac * 100, 1)} yük)` : tr.alan.verimSabit,
        result: `%${fmt(eta * 100, 2)}`,
      })
      const pIn = o.p / eta
      const qIn = pIn * tanPhi(girisPf)
      ownLoss = pIn - o.p
      input = { it: { ...out.it }, mech: { ...out.mech }, loss: { p: out.loss.p + ownLoss, q: out.loss.q + (qIn - o.q) } }
      // Üç bileşenin toplamı pIn ve qIn'e eşit olmalı: loss.q farkı kapatır.
      explain.push({ label: tr.hesap.upsInput, formula: `${fmt(o.p)} kW / ${fmt(eta, 4)}`, result: `${fmt(pIn)} kW` })
      explain.push({ label: tr.hesap.upsLoss, formula: `${fmt(pIn)} − ${fmt(o.p)}`, result: `${fmt(ownLoss)} kW` })
      explain.push({
        label: tr.hesap.upsInputQ,
        formula: `${fmt(pIn)} × tan(arccos ${fmt(girisPf)})`,
        result: `${fmt(qIn)} kvar`,
      })
    } else if (n.type === 'trafo' && en) {
      const sn = param(n, 'nominalKva')
      const ratio = sn > 0 ? kvaOf(sumPQ(out)) / sn : 0
      const p0 = param(n, 'bostaKayip')
      const pk = param(n, 'yukKayip')
      const lossP = p0 + pk * ratio * ratio
      // Reaktif kayıp: kısa devre reaktansı üzerinden, uk · Sn · (S/Sn)² (mıknatıslanma ihmal).
      const lossQ = (param(n, 'uk') / 100) * sn * ratio * ratio
      ownLoss = lossP
      input = { it: { ...out.it }, mech: { ...out.mech }, loss: { p: out.loss.p + lossP, q: out.loss.q + lossQ } }
      explain.push({
        label: tr.hesap.trafoLoss,
        formula: `${fmt(p0)} + ${fmt(pk)} × (${fmt(ratio, 4)})²`,
        result: `${fmt(lossP)} kW`,
      })
      explain.push({
        label: tr.hesap.trafoLossQ,
        formula: `${fmt(param(n, 'uk'))}% × ${fmt(sn)} kVA × (${fmt(ratio, 4)})²`,
        result: `${fmt(lossQ)} kvar`,
      })
    } else {
      input = out
    }
    inDemand.set(id, input)

    // Çıkış tarafı büyüklükleri ve kapasite
    const o = sumPQ(out)
    const kva = kvaOf(o)
    const voltage = outVoltage(n)
    const currentA = currentOf(kva, voltage)
    const i = sumPQ(input)
    explain.push({ label: tr.hesap.kva, formula: `√(${fmt(o.p)}² + ${fmt(o.q)}²)`, result: `${fmt(kva)} kVA` })
    explain.push({
      label: tr.hesap.current,
      formula: `${fmt(kva)} × 1000 / (√3 × ${fmt(voltage)} V)`,
      result: `${fmt(currentA)} A`,
    })

    const capacity: NodeResult['capacity'] = {}
    const ratios: number[] = []
    if (n.type === 'trafo' || n.type === 'jenerator' || n.type === 'ups') {
      const capKva = param(n, 'nominalKva')
      capacity.kva = capKva
      if (capKva > 0) {
        ratios.push(kva / capKva)
        explain.push({ label: tr.hesap.loadingKva, formula: `${fmt(kva)} / ${fmt(capKva)} kVA`, result: `%${fmt((kva / capKva) * 100)}` })
      }
      const capKw =
        n.type === 'ups' ? param(n, 'nominalKw') : n.type === 'jenerator' ? capKva * param(n, 'pf') : undefined
      if (capKw !== undefined) {
        capacity.kw = capKw
        if (capKw > 0) {
          ratios.push(o.p / capKw)
          explain.push({ label: tr.hesap.loadingKw, formula: `${fmt(o.p)} / ${fmt(capKw)} kW`, result: `%${fmt((o.p / capKw) * 100)}` })
        }
      }
    } else if (PANEL_TYPES.includes(n.type)) {
      const capA = param(n, 'nominalAkim')
      capacity.a = capA
      if (capA > 0) {
        ratios.push(currentA / capA)
        explain.push({ label: tr.hesap.loadingA, formula: `${fmt(currentA)} / ${fmt(capA)} A`, result: `%${fmt((currentA / capA) * 100)}` })
      }
    }
    const loadingPct = ratios.length ? Math.max(...ratios) * 100 : undefined

    nodeResults[id] = {
      id,
      cyclic: false,
      failed: failed.has(id),
      open: openSwitches.has(id),
      autoClosed: autoClosed.has(id),
      standby: false,
      onBattery: onBattery.has(id),
      energized: en,
      unservedKw,
      itKw: out.it.p,
      mechKw: out.mech.p,
      lossKw: out.loss.p,
      totalKw: o.p,
      kva,
      currentA,
      voltage,
      inputKw: i.p,
      inputKva: kvaOf(i),
      ownLossKw: ownLoss,
      weight: weight.get(id) ?? 0,
      capacity: Object.keys(capacity).length ? capacity : undefined,
      loadingPct,
      status: statusOf(loadingPct, th),
      explain,
    }
  }

  for (const n of model.nodes) {
    if (nodeResults[n.id]) continue
    nodeResults[n.id] = {
      id: n.id,
      cyclic: true,
      failed: failed.has(n.id),
      open: openSwitches.has(n.id),
      autoClosed: false,
      standby: false,
      onBattery: false,
      energized: false,
      unservedKw: 0,
      itKw: 0,
      mechKw: 0,
      lossKw: 0,
      totalKw: 0,
      kva: 0,
      currentA: 0,
      voltage: outVoltage(n),
      inputKw: 0,
      inputKva: 0,
      ownLossKw: 0,
      weight: 0,
      status: 'none',
      explain: [],
    }
    issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.cycle(n.ad) })
  }

  // 4) Hat sonuçları
  const edgeResults: Record<string, EdgeResult> = {}
  for (const e of edges) {
    const k = share.get(e.id)
    const child = inDemand.get(e.target)
    if (k === undefined || !child) continue
    const flow = sumPQ(child)
    const p = flow.p * k
    const q = flow.q * k
    const kva = Math.hypot(p, q)
    const pf = kva > 0 ? p / kva : 1
    const currentA = currentOf(kva, e.gerilim)
    const loadingPct = e.akimKapasitesi > 0 ? (currentA / e.akimKapasitesi) * 100 : undefined
    const lengthKm = e.uzunluk / 1000
    const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf))
    const dropV = SQRT3 * currentA * lengthKm * (e.r * pf + e.x * sinPhi)
    const voltageDropPct = e.gerilim > 0 ? (dropV / e.gerilim) * 100 : undefined
    const loss = edgeLoss.get(e.id) ?? { p: 0, q: 0 }
    const explain: ExplainStep[] = [
      { label: tr.hesap.share, formula: e.pay === null ? tr.line.payOto : `%${fmt(e.pay)}`, result: `%${fmt(k * 100)}` },
      { label: tr.hesap.flow, formula: `${fmt(flow.p)} kW × ${fmt(k)}`, result: `${fmt(p)} kW / ${fmt(kva)} kVA` },
      {
        label: tr.hesap.current,
        formula: `${fmt(kva)} × 1000 / (√3 × ${fmt(e.gerilim)} V)`,
        result: `${fmt(currentA)} A`,
      },
    ]
    if (e.akimKapasitesi > 0) {
      explain.push({
        label: tr.hesap.loadingA,
        formula: `${fmt(currentA)} / ${fmt(e.akimKapasitesi)} A`,
        result: `%${fmt(loadingPct ?? 0)}`,
      })
    }
    explain.push({
      label: tr.hesap.lineLoss,
      formula: `3 × (${fmt(currentA)} A)² × ${fmt(e.r)} Ω/km × ${fmt(lengthKm, 3)} km`,
      result: `${fmt(loss.p, 3)} kW`,
    })
    if (voltageDropPct !== undefined) {
      explain.push({
        label: tr.hesap.voltageDrop,
        formula: `√3 × ${fmt(currentA)} A × ${fmt(lengthKm, 3)} km × (${fmt(e.r)}·${fmt(pf, 3)} + ${fmt(e.x)}·${fmt(sinPhi, 3)}) / ${fmt(e.gerilim)} V`,
        result: `${fmt(dropV)} V (%${fmt(voltageDropPct)})`,
      })
    }
    edgeResults[e.id] = {
      id: e.id,
      share: k,
      live: edgeLive(e),
      p,
      q,
      kva,
      currentA,
      pf,
      loadingPct,
      voltageDropPct,
      lossKw: loss.p,
      lossKvar: loss.q,
      status: statusOf(loadingPct, th),
      explain,
    }
  }

  // 5) Doğrulama
  const reach = new Set<string>()
  const stack = model.nodes.filter((n) => !EQUIPMENT[n.type].hasInput).map((n) => n.id)
  while (stack.length) {
    const id = stack.pop()!
    if (reach.has(id)) continue
    reach.add(id)
    for (const e of outgoing.get(id)!) stack.push(e.target)
  }

  // Jeneratör hariç kaynaklardan (yapısal, arızalar yok sayılarak) ulaşılabilen düğümler.
  const normalReach = new Set<string>()
  const nStack = model.nodes.filter((n) => !EQUIPMENT[n.type].hasInput && n.type !== 'jenerator').map((n) => n.id)
  while (nStack.length) {
    const id = nStack.pop()!
    if (normalReach.has(id)) continue
    normalReach.add(id)
    for (const e of outgoing.get(id)!) nStack.push(e.target)
  }

  for (const n of model.nodes) {
    const def = EQUIPMENT[n.type]
    const nIn = allIn.get(n.id) ?? 0
    const nOut = allOut.get(n.id) ?? 0
    const res = nodeResults[n.id]
    if (nIn + nOut === 0) {
      if (model.nodes.length > 1) issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.disconnected(n.ad) })
    } else if (def.hasInput && !reach.has(n.id) && !res.cyclic && !failed.has(n.id)) {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.unreachable(n.ad) })
    } else if (!def.hasInput && nOut === 0) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.sourceNoOutput(n.ad) })
    } else if (def.hasInput && def.hasOutput && nOut === 0) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.noOutput(n.ad) })
    }

    if (nIn + nOut > 0 && !(outVoltage(n) > 0 && inVoltage(n) > 0)) {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.badVoltage(n.ad) })
    }
    if (TRANSFER_TYPES.includes(n.type)) {
      const ins = allEdges.filter((e) => e.target === n.id)
      if (ins.length < 2) {
        issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.transferOneInput(n.ad) })
      } else {
        const all = incoming.get(n.id)!
        const normalIns = all.filter((e) => normalReach.has(e.source))
        // Normal kaynaklı giriş varsa tercih belli sayılır (jeneratör zaten acil kaynaktır).
        const present = normalIns.length > 0 ? normalIns : all
        const explicit = present.filter((e) => e.pay !== null).map((e) => e.pay as number)
        const top = Math.max(...explicit, -1)
        const ambiguous = explicit.length === 0 || explicit.filter((v) => v === top).length > 1
        if (present.length > 1 && ambiguous) {
          issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.transferNoPreferred(n.ad) })
        }
      }
    }
    if (res.status === 'over') {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.overload(n.ad, fmt(res.loadingPct!, 1)) })
    } else if (res.status === 'warning') {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.nearLimit(n.ad, fmt(res.loadingPct!, 1)) })
    }
  }

  for (const e of allEdges) {
    const src = nodeById.get(e.source)!
    const dst = nodeById.get(e.target)!
    if (src.type === 'jenerator' && e.pay !== null && e.pay > 0) {
      const hasNormal = !LOAD_TYPES.includes(dst.type) && allEdges.some((x) => x.target === e.target && x.id !== e.id && normalReach.has(x.source))
      if (hasNormal) {
        issues.push({ severity: 'warning', edgeId: e.id, message: tr.analiz.generatorPay(src.ad, dst.ad, fmt(e.pay)) })
      }
    }
    const vs = outVoltage(src)
    const vd = inVoltage(dst)
    const differs = (a: number, b: number) => Math.abs(a - b) > 0.005 * Math.max(a, b)
    if (differs(vs, vd)) {
      issues.push({ severity: 'error', edgeId: e.id, message: tr.analiz.voltageMismatch(src.ad, vs, dst.ad, vd) })
    } else if (differs(e.gerilim, vs)) {
      issues.push({ severity: 'warning', edgeId: e.id, message: tr.analiz.lineVoltage(src.ad, dst.ad, e.gerilim, vs) })
    }
    const r = edgeResults[e.id]
    if (!r) continue
    if (r.status === 'over') {
      issues.push({ severity: 'error', edgeId: e.id, message: tr.analiz.lineOverload(src.ad, dst.ad, fmt(r.loadingPct!, 1)) })
    } else if (r.status === 'warning') {
      issues.push({ severity: 'warning', edgeId: e.id, message: tr.analiz.lineNearLimit(src.ad, dst.ad, fmt(r.loadingPct!, 1)) })
    }
    if (r.voltageDropPct !== undefined && r.voltageDropPct > th.voltageDropPct) {
      issues.push({
        severity: 'warning',
        edgeId: e.id,
        message: tr.analiz.voltageDrop(src.ad, dst.ad, fmt(r.voltageDropPct), fmt(th.voltageDropPct)),
      })
    }
  }

  // 5b) Port denetimi: var olmayan port ve aynı porta birden çok hat.
  const portUse = new Map<string, number>()
  for (const e of allEdges) {
    const src = nodeById.get(e.source)!
    const dst = nodeById.get(e.target)!
    if (e.kaynakPort >= portCount(src.type, src.params, 'out')) {
      issues.push({ severity: 'error', edgeId: e.id, message: tr.analiz.portMissing(src.ad, 'çıkış', e.kaynakPort + 1) })
    }
    if (e.hedefPort >= portCount(dst.type, dst.params, 'in')) {
      issues.push({ severity: 'error', edgeId: e.id, message: tr.analiz.portMissing(dst.ad, 'giriş', e.hedefPort + 1) })
    }
    for (const key of [`${e.source}:out:${e.kaynakPort}`, `${e.target}:in:${e.hedefPort}`]) {
      portUse.set(key, (portUse.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of portUse) {
    if (count < 2) continue
    const [id, dir, port] = key.split(':')
    issues.push({
      severity: 'error',
      nodeId: id,
      message: tr.analiz.portConflict(nodeById.get(id)!.ad, dir === 'in' ? 'giriş' : 'çıkış', Number(port) + 1, count),
    })
  }

  // 6) Toplam: kaynak düğümlerden çekilen güç
  const totals: Totals = { itKw: 0, mechKw: 0, lossKw: 0, totalKw: 0, kva: 0 }
  const sum = zeroDemand()
  for (const n of model.nodes) {
    if (EQUIPMENT[n.type].hasInput) continue
    const d = inDemand.get(n.id)
    if (d) addScaled(sum, d, 1)
  }
  const st = sumPQ(sum)
  totals.itKw = sum.it.p
  totals.mechKw = sum.mech.p
  totals.lossKw = sum.loss.p
  totals.totalKw = st.p
  totals.kva = kvaOf(st)

  // 7) Isıl yük: her ekipmanın yük/kayıp kalemi, ağırlığıyla ölçeklenip bırakıldığı
  // mekâna yazılır. Tüm elektrik gücü sonunda ısıya dönüştüğünden Σ ısı = Σ çekilen güç.
  const heat: HeatSummary = { salonKw: 0, elektrikKw: 0, disKw: 0, totalKw: 0 }
  const losses: LossBreakdown = { upsKw: 0, trafoKw: 0, lineKw: 0 }
  const addHeat = (loc: HeatLocation, kw: number) => {
    if (loc === 'salon') heat.salonKw += kw
    else if (loc === 'dis') heat.disKw += kw
    else heat.elektrikKw += kw
    heat.totalKw += kw
  }
  for (const id of order) {
    const n = nodeById.get(id)!
    const r = nodeResults[id]
    const w = weight.get(id) ?? 0
    if (w <= 0) continue
    if (LOAD_TYPES.includes(n.type)) {
      addHeat(heatLocation(n), r.totalKw * w)
    } else if (n.type === 'ups' || n.type === 'trafo') {
      addHeat(heatLocation(n), r.ownLossKw * w)
      if (n.type === 'ups') losses.upsKw += r.ownLossKw * w
      else losses.trafoKw += r.ownLossKw * w
    }
  }
  for (const e of edges) {
    const r = edgeResults[e.id]
    const src = nodeById.get(e.source)!
    if (!r) continue
    const w = (weight.get(e.source) ?? 0) * diversityOf(src)
    if (w <= 0) continue
    addHeat(e.isiKonum, r.lossKw * w)
    losses.lineKw += r.lossKw * w
  }

  // 8) Kaybedilen yük: kaynaklara normalde ulaşan ama senaryoda enerjisiz kalan yükler.
  // Senaryoda yalnızca temel durumda enerjili olup kaybedilen yükler 'kayıp' sayılır.
  const base = scenario ? (baseResult ?? analyze(model, th)) : undefined
  const unserved: Unserved = { itKw: 0, mechKw: 0, totalKw: 0 }
  const lost: { ad: string; kw: number }[] = []
  for (const n of model.nodes) {
    const r = nodeResults[n.id]
    if (!LOAD_TYPES.includes(n.type) || r.cyclic || r.energized) continue
    const isIt = (n.params.kategori ?? EQUIPMENT[n.type].defaults.kategori) === 'IT'
    if (isIt) unserved.itKw += r.unservedKw
    else unserved.mechKw += r.unservedKw
    unserved.totalKw += r.unservedKw
    // Senaryoda: temelde enerjili olup kaybedilenler. Temel durumda: kaynağa yapısal bağlantısı olup
    // açık anahtar/kesici nedeniyle enerjisiz kalan (gücü > 0) yükler.
    if (base ? base.nodes[n.id]?.energized : reach.has(n.id) && r.unservedKw > 0) lost.push({ ad: n.ad, kw: r.unservedKw })
  }
  if (lost.length > 0) {
    const kw = lost.reduce((a, l) => a + l.kw, 0)
    const names = lost.slice(0, 3).map((l) => l.ad).join(', ') + (lost.length > 3 ? '…' : '')
    issues.push({ severity: scenario ? 'error' : 'warning', message: tr.analiz.lostLoads(lost.length, fmt(kw), names) })
  }

  const pue = totals.itKw > 0 ? totals.totalKw / totals.itKw : undefined

  return { nodes: nodeResults, edges: edgeResults, issues, totals, unserved, heat, losses, pue }
}
