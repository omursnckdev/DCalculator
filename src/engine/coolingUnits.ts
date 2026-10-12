import { EQUIPMENT } from '../library/equipment'
import type { CoolingRole } from '../library/equipment'
import type { ProjectNode } from '../model/types'

/** Düğümün soğutma kapasitesi (termal kW); soğutma birimi değilse 0. */
export function coolingKw(n: ProjectNode): number {
  const def = EQUIPMENT[n.type]
  if (!def.hasInput || def.hasOutput || n.type === 'yardimci') return 0
  const v = n.params.sogutmaKw ?? def.defaults.sogutmaKw
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Soğutma birimi rolü: chiller 'produce', CRAH/fan wall/in-row/RDHx 'air', CRAC ve eski genel mekanik yük 'direct'.
 * Soğutma kapasitesi girilmemiş ekipman soğutma birimi sayılmaz (undefined).
 */
export function coolingRole(n: ProjectNode): CoolingRole | undefined {
  if (coolingKw(n) <= 0) return undefined
  return EQUIPMENT[n.type].coolingRole ?? 'direct'
}
