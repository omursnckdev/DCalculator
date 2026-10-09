/** Hesap motoru girdi/çıktı tipleri. React'a bağımlılığı yoktur. */
import type { ProjectEdge, ProjectNode } from '../model/types'

export interface Model {
  nodes: ProjectNode[]
  edges: ProjectEdge[]
}

/** Aktif (P, kW) ve reaktif (Q, kvar) güç. */
export interface PQ {
  p: number
  q: number
}

/** Bir noktadan geçen güç, kaynağına göre ayrıştırılmış. */
export interface Demand {
  it: PQ
  mech: PQ
  /** Aşağı yöndeki kayıplar (Faz 2'de yalnız UPS). */
  loss: PQ
}

export type Severity = 'error' | 'warning'

export interface Issue {
  severity: Severity
  nodeId?: string
  edgeId?: string
  message: string
}

/** none: kapasite tanımlı değil; ok < warn; warning: warn..over; over: > over */
export type LoadStatus = 'none' | 'ok' | 'warning' | 'over'

export interface ExplainStep {
  label: string
  formula: string
  result: string
}

export interface NodeResult {
  id: string
  /** Döngü içinde (veya döngüden beslenen) düğüm: hesaplanamadı. */
  cyclic: boolean
  /** Düğüm çıkışındaki (alt tarafındaki) yük, kW. */
  itKw: number
  mechKw: number
  lossKw: number
  totalKw: number
  kva: number
  /** Çıkış tarafı akımı (A); gerilim geçersizse 0. */
  currentA: number
  /** Çıkış tarafı gerilimi (V). */
  voltage: number
  /** Düğümün üstten çektiği güç (UPS'te kayıp dahil). */
  inputKw: number
  inputKva: number
  /** Düğümün kendi kaybı (UPS), kW. */
  ownLossKw: number
  capacity?: { kva?: number; kw?: number; a?: number }
  /** En kısıtlayıcı kapasiteye göre doluluk, %. */
  loadingPct?: number
  status: LoadStatus
  explain: ExplainStep[]
}

export interface EdgeResult {
  id: string
  /** Hedef düğümün talebinden bu hatta düşen pay, 0..1. */
  share: number
  p: number
  q: number
  kva: number
  currentA: number
  pf: number
  loadingPct?: number
  voltageDropPct?: number
  status: LoadStatus
  explain: ExplainStep[]
}

export interface Totals {
  itKw: number
  mechKw: number
  lossKw: number
  totalKw: number
  kva: number
}

export interface Analysis {
  nodes: Record<string, NodeResult>
  edges: Record<string, EdgeResult>
  issues: Issue[]
  /** Kaynak düğümlerden (şebeke/jeneratör) çekilen toplam. */
  totals: Totals
}

export interface Thresholds {
  /** Bu doluluktan (%) itibaren sarı. */
  warnPct: number
  /** Bu doluluğu (%) aşınca kırmızı. */
  overPct: number
  /** Hat gerilim düşümü uyarı sınırı, %. */
  voltageDropPct: number
}
