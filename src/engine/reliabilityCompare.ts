import { TEMPLATES } from '../library/templates'
import type { ProjectSettings } from '../model/settings'
import { reliabilityReport } from './reliability'

export interface TopologyRow {
  id: string
  ad: string
  availability: number
  downtimeMinPerYear: number
  nines: number
  tier?: string
  singles: number
}

/** Hazır şablonların (N, N+1, 2N) erişilebilirliğini varsayılan güvenilirlik verileriyle karşılaştırır. */
export function compareTemplates(s: ProjectSettings): TopologyRow[] {
  return TEMPLATES.map((t) => {
    const r = reliabilityReport(t.build(), s)
    return { id: t.id, ad: t.ad, availability: r.availability, downtimeMinPerYear: r.downtimeMinPerYear, nines: r.nines, tier: r.tier, singles: r.counts.single }
  })
}
