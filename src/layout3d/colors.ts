import { EQUIPMENT } from '../library/equipment'
import type { LoadStatus, NodeResult } from '../engine/types'
import type { ProjectNode } from '../model/types'
import { heatHex } from './heat'

export type ColorMode = 'tur' | 'doluluk' | 'isi' | 'enerji' | 'grup'
export const COLOR_MODES: ColorMode[] = ['tur', 'doluluk', 'isi', 'enerji', 'grup']

/** 2D şemadakiyle aynı durum renkleri (ui/status.ts ile aynı değerler). */
export const STATUS_HEX: Record<LoadStatus, string> = { none: '#94a3b8', ok: '#16a34a', warning: '#d97706', over: '#dc2626' }

export const FAILED_HEX = '#dc2626'
export const DEAD_HEX = '#6b7280'
export const SHED_HEX = '#f97316'

/** Düğümün bıraktığı ısı (kW): yükte kendi gücü, diğerlerinde kendi kaybı. */
export function heatKwOf(n: ProjectNode, r: NodeResult | undefined): number {
  if (!r || !r.energized) return 0
  const d = EQUIPMENT[n.type]
  return d.hasInput && !d.hasOutput ? r.totalKw : r.ownLossKw
}

export function groupHex(grup: string): string {
  if (!grup) return '#94a3b8'
  let h = 0
  for (let i = 0; i < grup.length; i++) h = (h * 31 + grup.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 55%, 52%)`
}

export interface ColorContext {
  mode: ColorMode
  /** Isı modunda ölçek üst sınırı (kW). */
  maxHeatKw: number
}

/**
 * Düğüm rengi. Durum bilgisi (arıza, atılan yük, enerjisiz) her modda önceliklidir; böylece simülasyon ve arıza senaryosu
 * mod ne olursa olsun 3D'de görünür. Doluluk modu 2D şemayla aynı eşikleri/renkleri kullanır.
 */
export function nodeColor(n: ProjectNode, r: NodeResult | undefined, ctx: ColorContext): string {
  if (r?.failed) return FAILED_HEX
  if (r?.shed) return SHED_HEX
  if (r && !r.energized) return DEAD_HEX
  switch (ctx.mode) {
    case 'doluluk':
      return STATUS_HEX[r?.status ?? 'none']
    case 'isi':
      return heatHex(ctx.maxHeatKw > 0 ? Math.min(1, heatKwOf(n, r) / ctx.maxHeatKw) : 0)
    case 'enerji':
      return '#16a34a'
    case 'grup':
      return groupHex(n.grup)
    default:
      return EQUIPMENT[n.type].color
  }
}
