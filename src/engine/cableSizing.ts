import type { ProjectSettings } from '../model/settings'
import type { ProjectEdge } from '../model/types'
import type { Analysis, Model } from './types'

/**
 * Kablo seçim yardımcısı (ön boyutlandırma): bakır iletkenli XLPE çok damarlı kablo, tavada (IEC 60364-5-52 yöntem E tipik
 * değerleri, 30 °C ortam, 3 yüklü iletken). Ortam sıcaklığı ve gruplama faktörüyle düzeltilir; en az paralel kablolu (sonra en küçük kesitli)
 * seçenek akım, gerilim düşümü ve kısa devre dayanımı koşullarını sağlar.
 */

export interface CableType {
  /** Kesit, mm². */
  s: number
  /** 30 °C'de akım taşıma kapasitesi, A. */
  iz: number
  /** 90 °C'de faz direnci, Ω/km. */
  r: number
  /** Reaktans, Ω/km. */
  x: number
}

export const CABLE_TABLE: CableType[] = [
  { s: 16, iz: 115, r: 1.467, x: 0.092 },
  { s: 25, iz: 149, r: 0.927, x: 0.092 },
  { s: 35, iz: 185, r: 0.668, x: 0.085 },
  { s: 50, iz: 225, r: 0.493, x: 0.085 },
  { s: 70, iz: 289, r: 0.342, x: 0.085 },
  { s: 95, iz: 352, r: 0.246, x: 0.082 },
  { s: 120, iz: 410, r: 0.195, x: 0.082 },
  { s: 150, iz: 473, r: 0.158, x: 0.082 },
  { s: 185, iz: 542, r: 0.126, x: 0.08 },
  { s: 240, iz: 641, r: 0.096, x: 0.08 },
  { s: 300, iz: 741, r: 0.077, x: 0.08 },
]

/** XLPE bakır iletkenin kısa devre ısıl dayanım katsayısı (k). */
const K_CU_XLPE = 143
const MAX_PARALLEL = 8

export interface CableSpec {
  n: number
  s: number
  /** Toplam (paralel) düzeltilmiş akım kapasitesi, A. */
  capacityA: number
  /** Toplam eşdeğer direnç ve reaktans, Ω/km. */
  r: number
  x: number
  dropPct: number
  /** Kısa devre için gereken en küçük kesit (tek kablo), mm². */
  sMinShortCircuit: number
}

export interface CableRow {
  edgeId: string
  name: string
  lengthM: number
  currentA: number
  /** Mevcut hat tanımı. */
  currentCapacityA: number
  currentDropPct?: number
  /** Önerilen seçenek; uygun kesit bulunamazsa undefined. */
  rec?: CableSpec
  /** Mevcut hat yeterli mi (kapasite ≥ akım ve gerilim düşümü ≤ sınır). */
  adequate: boolean
  reason?: 'capacity' | 'drop'
}

/** Sıcaklık düzeltme faktörü (XLPE 90 °C): √((90 − T) / (90 − 30)). */
export const tempFactor = (ambientC: number): number => Math.sqrt(Math.max(0.05, (90 - ambientC) / 60))

const SQRT3 = Math.sqrt(3)

/** Verilen yük akımı ve koşullar için en küçük toplam kesitli kablo seçeneği. */
export function sizeCable(opts: {
  currentA: number
  lengthM: number
  voltageV: number
  pf: number
  ambientC: number
  grouping: number
  dropLimitPct: number
  iscKa?: number
  scSec: number
}): CableSpec | undefined {
  const k = tempFactor(opts.ambientC) * opts.grouping
  const sinPhi = Math.sqrt(Math.max(0, 1 - opts.pf * opts.pf))
  let best: CableSpec | undefined
  for (let n = 1; n <= MAX_PARALLEL; n++) {
    for (const c of CABLE_TABLE) {
      const cap = c.iz * k * n
      if (cap < opts.currentA) continue
      const r = c.r / n
      const x = c.x / n
      const dropV = SQRT3 * opts.currentA * (opts.lengthM / 1000) * (r * opts.pf + x * sinPhi)
      const dropPct = opts.voltageV > 0 ? (dropV / opts.voltageV) * 100 : 0
      if (dropPct > opts.dropLimitPct) continue
      const sMin = opts.iscKa !== undefined ? ((opts.iscKa * 1000) / n) * Math.sqrt(opts.scSec) / K_CU_XLPE : 0
      if (c.s < sMin) continue
      best = { n, s: c.s, capacityA: cap, r, x, dropPct, sMinShortCircuit: sMin }
      break // bu paralel sayısında en küçük uygun kesit bulundu
    }
    if (best) return best // az kabloyla çözüm varsa paralel sayısı artırılmaz
  }
  return best
}

/** Tüm kablo hatları için analiz akımına göre öneri; busbar hatları kapsam dışıdır. */
export function cableStudy(model: Model, a: Analysis, s: ProjectSettings): CableRow[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const rows: CableRow[] = []
  for (const e of model.edges as ProjectEdge[]) {
    if (e.tip !== 'kablo' || e.durum !== 'kapali') continue
    const r = a.edges[e.id]
    if (!r || !r.live || r.currentA < 1) continue
    const src = byId.get(e.source)
    const dst = byId.get(e.target)
    const iscKa = a.nodes[e.source]?.iscKa
    const rec = sizeCable({
      currentA: r.currentA,
      lengthM: e.uzunluk,
      voltageV: e.gerilim,
      pf: Math.min(0.999, Math.max(0.5, r.pf)),
      ambientC: s.kabloOrtam,
      grouping: s.kabloGruplama,
      dropLimitPct: s.kabloDusum,
      iscKa,
      scSec: s.kabloKscSure,
    })
    const capOk = e.akimKapasitesi >= r.currentA
    const dropOk = r.voltageDropPct === undefined || r.voltageDropPct <= s.kabloDusum
    rows.push({
      edgeId: e.id,
      name: e.ad || `${src?.ad ?? e.source} → ${dst?.ad ?? e.target}`,
      lengthM: e.uzunluk,
      currentA: r.currentA,
      currentCapacityA: e.akimKapasitesi,
      currentDropPct: r.voltageDropPct,
      rec,
      adequate: capOk && dropOk,
      reason: !capOk ? 'capacity' : !dropOk ? 'drop' : undefined,
    })
  }
  return rows.sort((x, y) => Number(x.adequate) - Number(y.adequate) || y.currentA - x.currentA)
}
