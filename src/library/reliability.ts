import type { EquipmentType } from '../model/types'

/**
 * Tipik güvenilirlik verileri (saat). Kaynak: genel sektör mertebeleri (IEEE Gold/Orange Book, üretici katalogları);
 * değerler tesise, üreticiye ve bakım rejimine göre çok değişir — kendi verinizle değiştirin.
 */
export interface ReliabilityDefaults {
  /** Arızalar arası ortalama süre. */
  mtbf: number
  /** Ortalama onarım süresi. */
  mttr: number
}

export const RELIABILITY_DEFAULTS: Partial<Record<EquipmentType, ReliabilityDefaults>> = {
  sebeke: { mtbf: 4380, mttr: 2 }, // yılda ≈ 2 kesinti, 2 saat
  trafo: { mtbf: 300_000, mttr: 120 },
  jenerator: { mtbf: 20_000, mttr: 24 },
  mdb: { mtbf: 1_000_000, mttr: 12 },
  dagitimPanosu: { mtbf: 1_000_000, mttr: 8 },
  bara: { mtbf: 3_000_000, mttr: 12 },
  ups: { mtbf: 100_000, mttr: 8 },
  upsPanosu: { mtbf: 1_000_000, mttr: 8 },
  pdu: { mtbf: 1_000_000, mttr: 6 },
  rpp: { mtbf: 1_000_000, mttr: 6 },
  ats: { mtbf: 250_000, mttr: 8 },
  sts: { mtbf: 300_000, mttr: 4 },
  senkron: { mtbf: 150_000, mttr: 12 },
  kesici: { mtbf: 300_000, mttr: 4 },
}

/** Jeneratörün talepte çalışmama olasılığı (%): arıza durumuna ek eklenir. */
export const GEN_START_FAILURE_PCT = 1.5

/** Uptime Institute Tier kıyas değerleri: erişilebilirlik % ve yıllık izin verilen kesinti. */
export const TIERS: { name: string; availabilityPct: number }[] = [
  { name: 'Tier I', availabilityPct: 99.671 },
  { name: 'Tier II', availabilityPct: 99.741 },
  { name: 'Tier III', availabilityPct: 99.982 },
  { name: 'Tier IV', availabilityPct: 99.995 },
]
