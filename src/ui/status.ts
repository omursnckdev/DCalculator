import type { LoadStatus } from '../engine'

export const STATUS_COLOR: Record<LoadStatus, string> = {
  none: '#94a3b8',
  ok: '#16a34a',
  warning: '#d97706',
  over: '#dc2626',
}

export const STATUS_BG: Record<LoadStatus, string> = {
  none: '#f1f5f9',
  ok: '#dcfce7',
  warning: '#fef3c7',
  over: '#fee2e2',
}

export const fmtNum = (v: number, d = 1): string => v.toLocaleString('tr-TR', { maximumFractionDigits: d })
