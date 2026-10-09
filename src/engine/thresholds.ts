import type { LoadStatus, Thresholds } from './types'

/** Plan §6.2: yeşil < %80, sarı %80-100, kırmızı > %100. Gerilim düşümü sınırı: Açık Soru 8. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  warnPct: 80,
  overPct: 100,
  voltageDropPct: 3,
}

export function statusOf(pct: number | undefined, th: Thresholds): LoadStatus {
  if (pct === undefined || !Number.isFinite(pct)) return 'none'
  if (pct > th.overPct) return 'over'
  if (pct >= th.warnPct) return 'warning'
  return 'ok'
}
