import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, ProjectEdge, ProjectNode } from '../model/types'
import { DEFAULT_THRESHOLDS, statusOf } from './thresholds'
import type {
  Analysis,
  Demand,
  EdgeResult,
  ExplainStep,
  Issue,
  Model,
  NodeResult,
  PQ,
  Thresholds,
  Totals,
} from './types'

const SQRT3 = Math.sqrt(3)
const LOAD_TYPES: EquipmentType[] = ['itYuku', 'mekanikYuk', 'aydinlatma', 'genelYuk']
const PANEL_TYPES: EquipmentType[] = ['mdb', 'dagitimPanosu', 'bara', 'upsPanosu', 'pdu']

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

const fmt = (v: number, d = 2): string => v.toLocaleString('tr-TR', { maximumFractionDigits: d })

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

// --- ana hesap -------------------------------------------------------------

export function analyze(model: Model, th: Thresholds = DEFAULT_THRESHOLDS): Analysis {
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]))
  const edges = model.edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
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

  // 3) Yükten kaynağa doğru: ters topolojik sırada çıkış (O) ve giriş (D) talebi.
  const outDemand = new Map<string, Demand>()
  const inDemand = new Map<string, Demand>()
  const nodeResults: Record<string, NodeResult> = {}

  for (const id of [...order].reverse()) {
    const n = nodeById.get(id)!
    const explain: ExplainStep[] = []
    const out = zeroDemand()

    if (LOAD_TYPES.includes(n.type)) {
      const kw = param(n, 'kuruluKw')
      const df = param(n, 'df')
      const pf = param(n, 'pf')
      const p = kw * df
      const q = p * tanPhi(pf)
      const bucket = n.params.kategori === 'IT' || (n.params.kategori === undefined && n.type === 'itYuku') ? 'it' : 'mech'
      out[bucket] = { p, q }
      explain.push({ label: tr.hesap.peakKw, formula: `${fmt(kw)} kW × ${fmt(df)}`, result: `${fmt(p)} kW` })
      explain.push({
        label: tr.hesap.reactive,
        formula: `P × tan(arccos ${fmt(pf)})`,
        result: `${fmt(q)} kvar`,
      })
    } else {
      for (const e of outgoing.get(id)!) {
        const k = share.get(e.id)
        const child = inDemand.get(e.target)
        if (k === undefined || !child) continue
        addScaled(out, child, k)
      }
      const t = sumPQ(out)
      explain.push({
        label: tr.hesap.sumLoads,
        formula: `IT ${fmt(out.it.p)} + ${tr.alan.kategoriMekanik} ${fmt(out.mech.p)} + kayıp ${fmt(out.loss.p)}`,
        result: `${fmt(t.p)} kW`,
      })
      explain.push({ label: tr.hesap.sumReactive, formula: 'Σ Q', result: `${fmt(t.q)} kvar` })
    }
    outDemand.set(id, out)

    // Giriş talebi: UPS'te kayıp eklenir, diğerlerinde aynıdır (Faz 2).
    let input: Demand
    let ownLoss = 0
    if (n.type === 'ups') {
      const eta = Math.min(1, Math.max(0.01, param(n, 'verim') / 100))
      const girisPf = param(n, 'girisPf')
      const o = sumPQ(out)
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
      p,
      q,
      kva,
      currentA,
      pf,
      loadingPct,
      voltageDropPct,
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

  for (const n of model.nodes) {
    const def = EQUIPMENT[n.type]
    const nIn = incoming.get(n.id)!.length
    const nOut = outgoing.get(n.id)!.length
    const res = nodeResults[n.id]
    if (nIn + nOut === 0) {
      if (model.nodes.length > 1) issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.disconnected(n.ad) })
    } else if (def.hasInput && !reach.has(n.id) && !res.cyclic) {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.unreachable(n.ad) })
    } else if (!def.hasInput && nOut === 0) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.sourceNoOutput(n.ad) })
    } else if (def.hasInput && def.hasOutput && nOut === 0) {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.noOutput(n.ad) })
    }

    if (nIn + nOut > 0 && !(outVoltage(n) > 0 && inVoltage(n) > 0)) {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.badVoltage(n.ad) })
    }
    if (res.status === 'over') {
      issues.push({ severity: 'error', nodeId: n.id, message: tr.analiz.overload(n.ad, fmt(res.loadingPct!, 1)) })
    } else if (res.status === 'warning') {
      issues.push({ severity: 'warning', nodeId: n.id, message: tr.analiz.nearLimit(n.ad, fmt(res.loadingPct!, 1)) })
    }
  }

  for (const e of edges) {
    const src = nodeById.get(e.source)!
    const dst = nodeById.get(e.target)!
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

  return { nodes: nodeResults, edges: edgeResults, issues, totals }
}
