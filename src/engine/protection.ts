import { EQUIPMENT } from '../library/equipment'
import type { ProjectSettings } from '../model/settings'
import type { ProjectNode } from '../model/types'
import type { Analysis, Model } from './types'

/**
 * Koruma çalışmaları: kesici açma eğrileri (uzun gecikme I²t, kısa gecikme sabit süre, ani açma), seçicilik limiti ve
 * ark flaşı olay enerjisi (IEEE 1584-2002, ≤ 1 kV, basitleştirilmiş). Ön tasarım amaçlıdır; üretici eğrileri ve
 * IEEE 1584-2018 ile doğrulanmalıdır.
 */

export interface TripSettings {
  inA: number
  /** Uzun gecikme akımı, A. */
  irA: number
  /** Uzun gecikme süresi (6×Ir akımında), sn. */
  trSn: number
  /** Kısa gecikme eşiği, A (0 = kapalı) ve süresi, sn. */
  isdA: number
  tsdSn: number
  /** Ani açma eşiği, A (0 = kapalı). */
  iiA: number
}

const num = (n: ProjectNode, key: string): number => {
  const v = n.params[key] ?? EQUIPMENT[n.type].defaults[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Koruma cihazı mı: ACB veya MCCB (ayırıcı ve diğer tipler korumasızdır). */
export const isProtective = (n: ProjectNode): boolean => n.type === 'kesici' && (n.params.tip ?? 'ACB') !== 'Ayırıcı'

/** Kesici açma ayarı: "oto" modda tip varsayılanı (ACB: Isd 6×Ir/0,3 sn, Ii 15×In; MCCB: yalnız Ii 10×In), "özel"de alanlar. */
export function tripSettings(n: ProjectNode): TripSettings {
  const inA = num(n, 'nominalAkim')
  const acb = (n.params.tip ?? 'ACB') === 'ACB'
  const custom = (n.params.korumaModu ?? 'oto') === 'ozel'
  const ir = custom ? num(n, 'irOran') / 100 : 1
  const irA = inA * Math.max(0.1, ir)
  return {
    inA,
    irA,
    trSn: custom ? num(n, 'trSn') : 12,
    isdA: custom ? num(n, 'isdKat') * irA : acb ? 6 * irA : 0,
    tsdSn: custom ? num(n, 'tsdSn') : 0.3,
    iiA: custom ? num(n, 'iiKat') * inA : acb ? 15 * inA : 10 * inA,
  }
}

/** Açma süresi (sn); açmıyorsa Infinity. Ani açma ≈ 20 ms. */
export function tripTime(t: TripSettings, currentA: number): number {
  if (t.iiA > 0 && currentA >= t.iiA) return 0.02
  if (t.isdA > 0 && currentA >= t.isdA) return t.tsdSn
  if (currentA >= 1.05 * t.irA) return Math.min(7200, t.trSn * Math.pow((6 * t.irA) / currentA, 2))
  return Infinity
}

/** Log aralıklı akım örnekleri (A). */
const logSpace = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)))

/** Eğri noktaları: [akım A, süre sn] (açmayan bölge atlanır). */
export function curvePoints(t: TripSettings, fromA: number, toA: number, count = 80): [number, number][] {
  const pts: [number, number][] = []
  for (const i of logSpace(Math.max(1, fromA), Math.max(fromA * 1.01, toA), count)) {
    const s = tripTime(t, i)
    if (Number.isFinite(s)) pts.push([i, s])
  }
  return pts
}

/** Yukarı akış marjı: üst cihaz, alt cihazdan en az bu kat (+50 ms) geç açmalı. */
const SEL_MARGIN = 1.3
const SEL_EXTRA = 0.05

/**
 * Seçicilik limiti (A): alt cihazın hata akımı bu değere kadar yalnız alt cihaz açar (üst cihaz belirgin geç açar).
 * `maxA` içinde hiç ihlal yoksa `maxA` döner (tam seçicilik).
 */
export function selectivityLimitA(up: TripSettings, down: TripSettings, maxA: number): number {
  const from = Math.max(down.irA * 1.05, 1)
  if (maxA <= from) return maxA
  for (const i of logSpace(from, maxA, 400)) {
    const td = tripTime(down, i)
    if (!Number.isFinite(td)) continue
    const tu = tripTime(up, i)
    if (tu < SEL_MARGIN * td + SEL_EXTRA) return i
  }
  return maxA
}

export interface SelectivityRow {
  upId: string
  upName: string
  downId: string
  downName: string
  /** Alt cihazın bulunduğu noktadaki kısa devre akımı, kA. */
  iscKa: number
  /** Seçicilik limiti, kA. */
  limitKa: number
  status: 'total' | 'partial' | 'none'
}

/** Düğümün yukarı akışındaki en yakın koruma cihazları (trafo ve kaynağı geçmeden). */
function upstreamProtective(model: Model, id: string): ProjectNode[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const found = new Map<string, ProjectNode>()
  const seen = new Set<string>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of model.edges) {
      if (e.target !== cur || e.durum !== 'kapali') continue
      const s = byId.get(e.source)
      if (!s || seen.has(s.id)) continue
      seen.add(s.id)
      if (isProtective(s)) found.set(s.id, s)
      else if (s.type !== 'trafo' && EQUIPMENT[s.type].hasInput) stack.push(s.id)
    }
  }
  return [...found.values()]
}

/** Her koruma cihazı için yukarı akış cihazıyla seçicilik. Isc, analizdeki düğüm kısa devre akımıdır. */
export function selectivityStudy(model: Model, a: Analysis): SelectivityRow[] {
  const rows: SelectivityRow[] = []
  for (const d of model.nodes) {
    if (!isProtective(d)) continue
    const isc = a.nodes[d.id]?.iscKa
    if (isc === undefined) continue
    const td = tripSettings(d)
    for (const u of upstreamProtective(model, d.id)) {
      const tu = tripSettings(u)
      const maxA = isc * 1000
      const lim = selectivityLimitA(tu, td, maxA)
      rows.push({
        upId: u.id,
        upName: u.ad,
        downId: d.id,
        downName: d.ad,
        iscKa: isc,
        limitKa: lim / 1000,
        status: lim >= maxA * 0.999 ? 'total' : lim >= td.irA * 3 ? 'partial' : 'none',
      })
    }
  }
  return rows.sort((x, y) => (x.limitKa / x.iscKa) - (y.limitKa / y.iscKa))
}

// --- ark flaşı --------------------------------------------------------------

export interface ArcFlashRow {
  id: string
  name: string
  /** Boltlu hata akımı, kA ve ark akımı, kA. */
  ibfKa: number
  iaKa: number
  /** Temizleme süresi, sn (üst koruma cihazından; yoksa 2 sn varsayım). */
  clearingSec: number
  protectedBy?: string
  /** Olay enerjisi, cal/cm². */
  energy: number
  /** NFPA 70E kategorisi 0–4; 5: > 40 cal/cm² (tehlikeli). */
  ppe: 0 | 1 | 2 | 3 | 4 | 5
}

const PANEL_TYPES = ['mdb', 'dagitimPanosu', 'bara', 'upsPanosu', 'pdu', 'rpp', 'rmu', 'ats', 'sts', 'senkron']

export function ppeCategory(cal: number): ArcFlashRow['ppe'] {
  return cal <= 1.2 ? 0 : cal <= 4 ? 1 : cal <= 8 ? 2 : cal <= 25 ? 3 : cal <= 40 ? 4 : 5
}

/**
 * IEEE 1584-2002 (≤ 1 kV, kutu içinde, topraklı): ark akımı Ia, normalleştirilmiş enerji En (0,2 sn, 610 mm) ve
 * olay enerjisi E = 4,184·Cf·En·(t/0,2)·(610^x/D^x) [J/cm²]; Cf = 1,5, x = 1,473 (alçak gerilim şalt).
 */
export function arcEnergy(ibfKa: number, voltageV: number, gapMm: number, distMm: number, tSec: number): { iaKa: number; calPerCm2: number } {
  const v = voltageV / 1000
  const lg = Math.log10(Math.max(0.001, ibfKa))
  const logIa = -0.097 + 0.662 * lg + 0.0966 * v + 0.000526 * gapMm + 0.5588 * v * lg - 0.00304 * gapMm * lg
  const ia = Math.pow(10, logIa)
  const logEn = -0.555 - 0.113 + 1.081 * Math.log10(Math.max(0.001, ia)) + 0.0011 * gapMm
  const en = Math.pow(10, logEn)
  const x = 1.473
  const eJ = 4.184 * 1.5 * en * (tSec / 0.2) * (Math.pow(610, x) / Math.pow(distMm, x))
  return { iaKa: ia, calPerCm2: eJ / 4.184 }
}

/** Her panonun ark flaşı: temizleme süresi, panonun yukarısındaki en yavaş koruma cihazının Ia (ve %85 Ia) açma süresidir. */
export function arcFlashStudy(model: Model, a: Analysis, s: Pick<ProjectSettings, 'arkMesafe' | 'arkAralik'>): ArcFlashRow[] {
  const rows: ArcFlashRow[] = []
  for (const n of model.nodes) {
    if (!PANEL_TYPES.includes(n.type)) continue
    const r = a.nodes[n.id]
    if (!r || r.iscKa === undefined || !r.energized) continue
    const v = r.voltage
    const probe = arcEnergy(r.iscKa, v, s.arkAralik, s.arkMesafe, 1)
    const ups = upstreamProtective(model, n.id)
    let t = 2
    let by: string | undefined
    if (ups.length > 0) {
      let worst = 0
      for (const u of ups) {
        const ts = tripSettings(u)
        const tt = Math.max(tripTime(ts, probe.iaKa * 1000), tripTime(ts, probe.iaKa * 850))
        const eff = Number.isFinite(tt) ? Math.min(tt, 2) : 2
        if (eff >= worst) {
          worst = eff
          by = u.ad
        }
      }
      t = worst
    }
    const e = arcEnergy(r.iscKa, v, s.arkAralik, s.arkMesafe, t)
    rows.push({ id: n.id, name: n.ad, ibfKa: r.iscKa, iaKa: e.iaKa, clearingSec: t, protectedBy: by, energy: e.calPerCm2, ppe: ppeCategory(e.calPerCm2) })
  }
  return rows.sort((x, y) => y.energy - x.energy)
}
